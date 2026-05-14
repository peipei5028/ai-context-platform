import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.bridge.gitnexus_bridge import bridge
from app.config import settings
from app.core.quota_service import check_app_quota
from app.models.app import App
from app.models.base import gen_id
from app.models.system import System

logger = logging.getLogger("ai-context-service.app")


class AppService:
    @staticmethod
    async def create_app(
        db: AsyncSession,
        system_id: str,
        name: str,
        git_url: str,
        tracked_branch: str = "main",
        tech_stack: str | None = None,
        owner: str | None = None,
        created_by: int | None = None,
    ) -> App | None:
        stmt = select(System).where(System.id == system_id, System.deleted == False)  # noqa: E712
        result = await db.execute(stmt)
        system = result.scalar_one_or_none()
        if not system:
            return None

        await check_app_quota(db, system_id)

        existing = await db.execute(
            select(App).where(
                App.system_id == system_id,
                App.name == name,
                App.deleted == False,  # noqa: E712
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError(f"App with name '{name}' already exists in this system")

        repo_path = f"{settings.REPOS_ROOT_DIR}/{system.name}/{name}"
        app = App(
            id=gen_id(),
            system_id=system_id,
            name=name,
            git_url=git_url,
            repo_path=repo_path,
            tracked_branch=tracked_branch,
            tech_stack=tech_stack,
            owner=owner,
            created_by=created_by,
        )
        db.add(app)
        await db.commit()
        await db.refresh(app)

        try:
            await bridge.group_add(system.group_name, repo_path, name)
        except Exception:
            logger.warning(f"Failed to add app to GitNexus group, continuing")

        return app

    @staticmethod
    async def list_apps(db: AsyncSession, system_id: str) -> list[App]:
        stmt = select(App).where(
            App.system_id == system_id, App.deleted == False  # noqa: E712
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def get_app(db: AsyncSession, app_id: str) -> App | None:
        stmt = (
            select(App)
            .options(selectinload(App.system))
            .where(App.id == app_id, App.deleted == False)  # noqa: E712
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def update_app(db: AsyncSession, app_id: str, **kwargs) -> App | None:
        app = await AppService.get_app(db, app_id)
        if not app:
            return None
        for key, value in kwargs.items():
            if value is not None and hasattr(app, key):
                setattr(app, key, value)
        await db.commit()
        await db.refresh(app)
        return app

    @staticmethod
    async def delete_app(db: AsyncSession, app_id: str) -> bool:
        app = await AppService.get_app(db, app_id)
        if not app:
            return False

        system = app.system

        app.deleted = True
        await db.commit()

        if system:
            try:
                await bridge.group_sync(system.group_name)
                logger.info(f"Triggered group_sync for '{system.group_name}' after app deletion")
            except Exception:
                logger.warning(f"group_sync failed after deleting app from '{system.group_name}'")

        return True
