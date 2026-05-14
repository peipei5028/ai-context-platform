import asyncio
import json
import logging
import os
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session_factory
from app.bridge.gitnexus_bridge import bridge
from app.config import settings
from app.core.encryption import decrypt
from app.models.app import App
from app.models.index_job import IndexJob
from app.models.system import System

logger = logging.getLogger("ai-context-service.scheduler")

_semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_INDEX_JOBS)
_active_repos: dict[str, int] = {}
_cli_lock = asyncio.Lock()


async def recover_stale_jobs():
    """Startup: mark orphaned pending/running jobs as failed (process restarted)."""
    session_factory = get_session_factory()
    async with session_factory() as db:
        stmt = select(IndexJob).where(IndexJob.status.in_(["pending", "running"]))
        result = await db.execute(stmt)
        stale_jobs = result.scalars().all()
        if not stale_jobs:
            return
        for job in stale_jobs:
            job.status = "failed"
            job.error_message = "Job interrupted by server restart"
            job.completed_at = datetime.utcnow()
            app = await db.get(App, job.app_id)
            if app and app.index_status in ("pending", "running"):
                app.index_status = "failed"
        await db.commit()
        logger.info(f"Recovered {len(stale_jobs)} stale index jobs")


class IndexScheduler:
    @staticmethod
    async def trigger_index(
        db: AsyncSession,
        app_id: str,
        include_wiki: bool = True,
        force: bool = False,
    ) -> IndexJob:
        stmt = select(App).where(App.id == app_id, App.deleted == False)  # noqa: E712
        result = await db.execute(stmt)
        app = result.scalar_one_or_none()
        if not app:
            raise ValueError("App not found")

        if app.index_status in ("pending", "running"):
            raise ValueError("App is already being indexed")

        # Optimistic lock: only proceed if version matches
        current_version = app.version
        result_row = await db.execute(
            update(App)
            .where(App.id == app_id, App.version == current_version)
            .values(index_status="pending", version=current_version + 1)
        )
        if result_row.rowcount == 0:
            raise ValueError("Concurrent modification detected, please retry")

        await db.refresh(app)

        job = IndexJob(
            app_id=app_id,
            status="pending",
            trigger_type="manual",
            include_wiki=include_wiki,
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)

        stmt_sys = select(System).where(System.id == app.system_id)
        result_sys = await db.execute(stmt_sys)
        system = result_sys.scalar_one_or_none()

        task = asyncio.create_task(
            IndexScheduler._execute_index(
                job_id=job.id,
                app_id=app_id,
                repo_path=app.repo_path or "",
                git_url=app.git_url,
                tracked_branch=app.tracked_branch,
                group_name=system.group_name if system else "",
                include_wiki=include_wiki,
                force=force,
                expected_version=app.version,
                gitlab_username=system.gitlab_username if system else None,
                gitlab_token=system.gitlab_token if system else None,
            )
        )
        task.add_done_callback(lambda t: t.exception() if not t.cancelled() and t.exception() else None)
        return job

    @staticmethod
    async def _execute_index(
        job_id: int,
        app_id: str,
        repo_path: str,
        git_url: str,
        tracked_branch: str,
        group_name: str,
        include_wiki: bool,
        force: bool,
        expected_version: int,
        gitlab_username: str | None = None,
        gitlab_token: str | None = None,
    ):
        async with _semaphore:
            logger.info(f"Job {job_id}: starting execution, repo={repo_path}, git_url={git_url}, branch={tracked_branch}")
            if repo_path in _active_repos:
                logger.warning(f"Repo {repo_path} already being indexed, aborting job {job_id}")
                await _update_job_failed(job_id, "Repo is already being indexed by another job")
                return

            _active_repos[repo_path] = job_id
            session_factory = get_session_factory()

            try:
                async with session_factory() as db:
                    job = await db.get(IndexJob, job_id)

                    # Check for cancellation before starting
                    if job.status == "cancelled":
                        logger.info(f"Job {job_id} was cancelled before execution")
                        return

                    # Optimistic lock: pending -> running
                    result_row = await db.execute(
                        update(IndexJob)
                        .where(IndexJob.id == job_id, IndexJob.status == "pending")
                        .values(status="running", started_at=datetime.utcnow())
                    )
                    if result_row.rowcount == 0:
                        current_job = await db.get(IndexJob, job_id)
                        if current_job and current_job.status == "cancelled":
                            logger.info(f"Job {job_id} was cancelled, skipping execution")
                        else:
                            logger.warning(f"Job {job_id} cannot transition to running, aborting")
                        return

                    await db.commit()

                # Step 1: clone or pull
                await _emit_sse(job_id, "progress", {"phase": "cloning"})
                plain_token = decrypt(gitlab_token) if gitlab_token else None
                logger.info(f"Job {job_id}: gitlab_username={gitlab_username}, has_token={plain_token is not None}")
                await bridge.clone_or_pull(
                    git_url, repo_path, tracked_branch,
                    gitlab_username=gitlab_username,
                    gitlab_token=plain_token,
                )

                # Step 2: analyze
                await _emit_sse(job_id, "progress", {"phase": "analyzing"})
                await bridge.analyze(repo_path, force=force)

                # Step 3: wiki — atomic replacement
                if include_wiki:
                    await _emit_sse(job_id, "progress", {"phase": "generating_wiki"})
                    wiki_new_dir = os.path.join(repo_path, "wiki_new")
                    wiki_dir = os.path.join(repo_path, "wiki")

                    # Temporarily point to wiki_new for generation
                    await bridge.generate_wiki(repo_path, force=force)

                    # Atomic rename: wiki_new -> wiki
                    if os.path.isdir(wiki_new_dir):
                        wiki_bak = os.path.join(repo_path, "wiki_bak")
                        if os.path.isdir(wiki_dir):
                            os.rename(wiki_dir, wiki_bak)
                        os.rename(wiki_new_dir, wiki_dir)
                        # Clean up backup
                        if os.path.isdir(wiki_bak):
                            import shutil
                            shutil.rmtree(wiki_bak, ignore_errors=True)

                # Step 4: group_sync
                if group_name:
                    await _emit_sse(job_id, "progress", {"phase": "syncing_group"})
                    async with _cli_lock:
                        await bridge.group_add(group_name, repo_path, app_id)
                        await bridge.group_sync(group_name)

                # Step 5: read results
                commit = await bridge.get_current_commit(repo_path)
                meta = bridge.read_meta_json(repo_path)
                stats = meta.get("stats", {}) if meta else {}

                async with session_factory() as db:
                    job = await db.get(IndexJob, job_id)
                    if job.status == "cancelled":
                        logger.info(f"Job {job_id} was cancelled during execution, skipping success update")
                        return

                    job.status = "success"
                    job.completed_at = datetime.utcnow()
                    job.commit_hash = commit
                    job.stats = stats

                    app = await db.get(App, app_id)
                    app.index_status = "success"
                    app.last_indexed_at = datetime.utcnow()
                    app.last_commit = commit
                    if not app.repo_path:
                        app.repo_path = repo_path
                    app.version = expected_version + 1
                    await db.commit()

                await _emit_sse(job_id, "completed", {"stats": stats, "commit": commit})
                logger.info(f"Index job {job_id} completed for {repo_path}")

            except Exception as e:
                logger.error(f"Index job {job_id} failed: {e}")

                async with session_factory() as db:
                    job = await db.get(IndexJob, job_id)
                    if job and job.status != "cancelled":
                        job.status = "failed"
                        job.error_message = str(e)
                        job.completed_at = datetime.utcnow()

                        app = await db.get(App, app_id)
                        if app:
                            app.index_status = "failed"
                        await db.commit()

                await _emit_sse(job_id, "failed", {"error": str(e)})

            finally:
                _active_repos.pop(repo_path, None)

    @staticmethod
    async def cancel_index(db: AsyncSession, app_id: str) -> bool:
        """Cancel any pending or running index job for the given app."""
        stmt = (
            select(IndexJob)
            .where(
                IndexJob.app_id == app_id,
                IndexJob.status.in_(["pending", "running"]),
            )
            .order_by(IndexJob.id.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        job = result.scalar_one_or_none()
        if not job:
            return False

        job.status = "cancelled"
        job.cancel_reason = "Cancelled by user"
        job.completed_at = datetime.utcnow()

        app = await db.get(App, app_id)
        if app:
            app.index_status = "cancelled"

        await db.commit()

        await _emit_sse(job.id, "cancelled", {"reason": "Cancelled by user"})
        return True

    @staticmethod
    async def get_job_status(db: AsyncSession, job_id: int) -> IndexJob | None:
        return await db.get(IndexJob, job_id)

    @staticmethod
    async def get_app_index_status(db: AsyncSession, app_id: str) -> dict | None:
        stmt = select(App).where(App.id == app_id, App.deleted == False)  # noqa: E712
        result = await db.execute(stmt)
        app = result.scalar_one_or_none()
        if not app:
            return None

        # Get current job id if pending/running
        current_job_id = None
        if app.index_status in ("pending", "running"):
            job_stmt = (
                select(IndexJob.id)
                .where(IndexJob.app_id == app_id, IndexJob.status.in_(["pending", "running"]))
                .order_by(IndexJob.id.desc())
                .limit(1)
            )
            job_result = await db.execute(job_stmt)
            row = job_result.scalar_one_or_none()
            if row:
                current_job_id = row

        return {
            "status": app.index_status,
            "version": app.version,
            "last_commit": app.last_commit,
            "last_indexed_at": app.last_indexed_at.isoformat() if app.last_indexed_at else None,
            "current_job_id": current_job_id,
        }

    @staticmethod
    async def stream_progress(job_id: int):
        """SSE stream: emits progress/log/completed/failed/cancelled events."""
        session_factory = get_session_factory()
        last_status = None
        while True:
            async with session_factory() as db:
                job = await db.get(IndexJob, job_id)
            if not job:
                yield f"event: failed\ndata: {json.dumps({'error': 'job not found'})}\n\n"
                break
            if job.status != last_status:
                last_status = job.status

                if job.status == "running":
                    yield f"event: progress\ndata: {json.dumps({'status': 'running'})}\n\n"
                elif job.status == "success":
                    payload = {"stats": job.stats, "commit": job.commit_hash}
                    yield f"event: completed\ndata: {json.dumps(payload)}\n\n"
                elif job.status == "failed":
                    yield f"event: failed\ndata: {json.dumps({'error': job.error_message})}\n\n"
                elif job.status == "cancelled":
                    yield f"event: cancelled\ndata: {json.dumps({'reason': job.cancel_reason})}\n\n"

            if job.status in ("success", "failed", "cancelled"):
                break
            await asyncio.sleep(2)


async def _emit_sse(job_id: int, event_type: str, data: dict):
    """Helper to log SSE events (actual SSE delivery is via stream_progress)."""
    logger.info(f"SSE event for job {job_id}: event={event_type}, data={data}")


async def _update_job_failed(job_id: int, error: str):
    session_factory = get_session_factory()
    try:
        async with session_factory() as db:
            job = await db.get(IndexJob, job_id)
            if job:
                job.status = "failed"
                job.error_message = error
                job.completed_at = datetime.utcnow()

                app = await db.get(App, job.app_id)
                if app:
                    app.index_status = "failed"
                await db.commit()
    except Exception as e:
        logger.error(f"Failed to update job {job_id} as failed: {e}")
