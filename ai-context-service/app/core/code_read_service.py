import asyncio
import logging
from itertools import islice
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bridge.gitnexus_bridge import bridge
from app.models.app import App
from app.models.user import User

logger = logging.getLogger("ai-context-service.code_read")

BINARY_CHECK_SIZE = 8192


class CodeReadService:
    @staticmethod
    async def read_batch(
        db: AsyncSession,
        user: User,
        items: list[dict],
        max_bytes: int,
    ) -> tuple[list[dict], list[dict]]:
        # Batch load apps
        app_ids = list({item["app_id"] for item in items})
        stmt = select(App).where(
            App.id.in_(app_ids),
            App.deleted == False,  # noqa: E712
        )
        result = await db.execute(stmt)
        app_map = {app.id: app for app in result.scalars().all()}

        # Resolve commits per unique repo_path
        commit_cache: dict[str, str | None] = {}
        unique_repo_paths = {
            app.repo_path
            for app in app_map.values()
            if app.repo_path
        }
        for repo_path in unique_repo_paths:
            try:
                commit_cache[repo_path] = await bridge.get_current_commit(repo_path)
            except Exception:
                matching = [a for a in app_map.values() if a.repo_path == repo_path]
                commit_cache[repo_path] = matching[0].last_commit if matching else None

        results: list[dict] = []
        errors: list[dict] = []

        for item in items:
            app = app_map.get(item["app_id"])

            if not app:
                errors.append({"app_id": item["app_id"], "path": item["path"], "error": "App not found"})
                continue
            if app.index_status != "success":
                errors.append({"app_id": item["app_id"], "path": item["path"], "error": f"App not indexed (status: {app.index_status})"})
                continue
            if not app.repo_path:
                errors.append({"app_id": item["app_id"], "path": item["path"], "error": "App repo path not configured"})
                continue
            if user.role != "admin" and app.created_by != user.id:
                errors.append({"app_id": item["app_id"], "path": item["path"], "error": "No permission to read files from this app"})
                continue

            try:
                resolved = _validate_path(app.repo_path, item["path"])
            except ValueError as e:
                errors.append({"app_id": item["app_id"], "path": item["path"], "error": str(e)})
                continue

            try:
                content, truncated, actual_start, actual_end = await asyncio.to_thread(
                    _read_file, resolved, item.get("start_line"), item.get("end_line"), max_bytes
                )
            except IsBinaryError:
                errors.append({"app_id": item["app_id"], "path": item["path"], "error": f"File is binary and cannot be read: {item['path']}"})
                continue
            except FileNotFoundError:
                errors.append({"app_id": item["app_id"], "path": item["path"], "error": f"File not found: {item['path']}"})
                continue
            except Exception as e:
                errors.append({"app_id": item["app_id"], "path": item["path"], "error": f"Failed to read file: {e}"})
                continue

            results.append({
                "app_id": item["app_id"],
                "repo_path": app.repo_path,
                "ref": item.get("ref", app.tracked_branch),
                "path": item["path"],
                "resolved_commit": commit_cache.get(app.repo_path),
                "content": content,
                "truncated": truncated,
                "line_range": {"start": actual_start, "end": actual_end},
            })

        return results, errors


class IsBinaryError(Exception):
    pass


def _validate_path(repo_path: str, file_path: str) -> Path:
    if ".." in file_path.split("/"):
        raise ValueError("Invalid file path")
    if file_path.startswith("/"):
        raise ValueError("Invalid file path")

    resolved = (Path(repo_path) / file_path).resolve()
    repo_resolved = Path(repo_path).resolve()

    if not str(resolved).startswith(str(repo_resolved) + "/") and resolved != repo_resolved:
        raise ValueError("Invalid file path")

    if not resolved.is_file():
        raise FileNotFoundError(f"File not found: {file_path}")

    return resolved


def _is_binary(file_path: Path) -> bool:
    with open(file_path, "rb") as f:
        chunk = f.read(BINARY_CHECK_SIZE)
    return b"\x00" in chunk


def _read_file(
    file_path: Path,
    start_line: int | None,
    end_line: int | None,
    max_bytes: int,
) -> tuple[str, bool, int, int]:
    if _is_binary(file_path):
        raise IsBinaryError()

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        if start_line is not None or end_line is not None:
            s = max(1, start_line or 1)
            e = end_line or 0
            lines = []
            for i, line in enumerate(f, 1):
                if i > e > 0:
                    break
                if i >= s:
                    lines.append(line)
            content = "".join(lines)
            actual_start = s
            actual_end = e if e > 0 else s + len(lines) - 1
        else:
            content = f.read()
            line_count = content.count("\n")
            if content and not content.endswith("\n"):
                line_count += 1
            elif not content:
                line_count = 0
            actual_start = 1
            actual_end = max(1, line_count)

    truncated = False
    if len(content.encode("utf-8")) > max_bytes:
        truncated_bytes = content.encode("utf-8")[:max_bytes]
        content = truncated_bytes.decode("utf-8", errors="ignore")
        truncated = True

    return content, truncated, actual_start, actual_end
