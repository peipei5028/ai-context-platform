from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.app_service import AppService
from app.core.auth_service import User, can_modify, get_current_user
from app.core.system_service import SystemService

router = APIRouter(tags=["apps"])


class AppCreate(BaseModel):
    name: str
    git_url: str
    tracked_branch: str = "main"
    tech_stack: str | None = None
    owner: str | None = None


class AppUpdate(BaseModel):
    name: str | None = None
    git_url: str | None = None
    tracked_branch: str | None = None
    tech_stack: str | None = None
    owner: str | None = None


async def _check_system_permission(system_id: str, user: User, db):
    system = await SystemService.get_system(db, system_id)
    if not system:
        raise HTTPException(404, "System not found")
    if not can_modify(user, system.created_by):
        raise HTTPException(403, "No permission to modify this system")
    return system


@router.post("/systems/{system_id}/apps", status_code=201)
async def create_app(
    system_id: str, body: AppCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_system_permission(system_id, user, db)
    try:
        app = await AppService.create_app(
            db, system_id=system_id, name=body.name, git_url=body.git_url,
            tracked_branch=body.tracked_branch, tech_stack=body.tech_stack,
            owner=body.owner, created_by=user.id,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))
    if not app:
        raise HTTPException(404, "System not found")
    return app


@router.get("/systems/{system_id}/apps")
async def list_apps(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    apps = await AppService.list_apps(db, system_id)
    return apps


@router.get("/apps/{app_id}")
async def get_app(
    app_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    app = await AppService.get_app(db, app_id)
    if not app:
        raise HTTPException(404, "App not found")
    return app


@router.put("/apps/{app_id}")
async def update_app(
    app_id: str, body: AppUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    app = await AppService.get_app(db, app_id)
    if not app:
        raise HTTPException(404, "App not found")
    if not can_modify(user, app.created_by):
        raise HTTPException(403, "No permission to modify this app")
    app = await AppService.update_app(db, app_id, **body.model_dump(exclude_none=True))
    return app


@router.delete("/apps/{app_id}")
async def delete_app(
    app_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    app = await AppService.get_app(db, app_id)
    if not app:
        raise HTTPException(404, "App not found")
    if not can_modify(user, app.created_by):
        raise HTTPException(403, "No permission to delete this app")
    if not await AppService.delete_app(db, app_id):
        raise HTTPException(404, "App not found")
    return {"message": "deleted"}
