from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.bridge.gitnexus_bridge import bridge
from app.core.app_service import AppService
from app.core.auth_service import User, get_current_user
from app.models.app import App
from app.models.system_relation import SystemRelation

router = APIRouter(tags=["impact"])


class ImpactRequest(BaseModel):
    target: str
    direction: str = "both"
    depth: int = 3
    cross_project: bool = False
    cross_system: bool = False


async def _get_repo_name(app: App) -> str | None:
    repos = await bridge.get_repos()
    repo_path = app.repo_path
    if repo_path:
        for r in repos:
            if r.get("path") == repo_path:
                return r.get("name")
    for r in repos:
        if r.get("name") == app.name:
            return app.name
    return None


@router.post("/apps/{app_id}/impact")
async def analyze_impact(
    app_id: str, body: ImpactRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    app = await AppService.get_app(db, app_id)
    if not app:
        raise HTTPException(404, "App not found")
    if app.index_status not in ("success", "current"):
        if app.index_status == "none":
            raise HTTPException(400, "App has not been indexed yet")
        if app.index_status in ("pending", "running"):
            raise HTTPException(503, "Indexing in progress")
        raise HTTPException(400, f"App index status: {app.index_status}")

    repo = await _get_repo_name(app)

    try:
        result = await _do_impact(body.target, body.direction, body.depth, repo)
    except Exception as e:
        raise HTTPException(502, f"GitNexus query failed: {e}")

    if body.cross_system:
        stmt = select(SystemRelation).where(
            SystemRelation.source_system_id == app.system_id
        )
        rels = (await db.execute(stmt)).scalars().all()
        cross_system_impacts = []
        for rel in rels:
            stmt2 = select(App).where(App.system_id == rel.target_system_id)
            target_apps = (await db.execute(stmt2)).scalars().all()
            for ta in target_apps:
                if ta.index_status == "success":
                    try:
                        ta_repo = await _get_repo_name(ta)
                        cs_result = await _do_impact(
                            body.target, body.direction, body.depth, ta_repo
                        )
                        if cs_result.get("summary", {}).get("direct_upstream", 0) > 0 or \
                           cs_result.get("summary", {}).get("direct_downstream", 0) > 0:
                            cross_system_impacts.append({
                                "system_id": rel.target_system_id,
                                "app_id": ta.id,
                                "app_name": ta.name,
                                "symbols": cs_result.get("upstream", []) + cs_result.get("downstream", []),
                            })
                    except Exception:
                        pass
        result["cross_system_impacts"] = cross_system_impacts

    return result


async def _do_impact(target: str, direction: str, depth: int, repo: str | None) -> dict:
    # Use gitnexus query CLI to find relevant processes
    query_data = await bridge.query(target, repo=repo, limit=5)

    # Use gitnexus impact CLI for blast radius analysis
    impact_data = {}
    if direction in ("upstream", "both"):
        try:
            up = await bridge.impact(target, direction="upstream", depth=depth, repo=repo)
            impact_data["upstream"] = up
        except Exception:
            impact_data["upstream"] = {}
    if direction in ("downstream", "both"):
        try:
            down = await bridge.impact(target, direction="downstream", depth=depth, repo=repo)
            impact_data["downstream"] = down
        except Exception:
            impact_data["downstream"] = {}

    up_data = impact_data.get("upstream", {})
    down_data = impact_data.get("downstream", {})

    up_by_depth = up_data.get("byDepth", {}) if isinstance(up_data, dict) else {}
    down_by_depth = down_data.get("byDepth", {}) if isinstance(down_data, dict) else {}

    d1_up = up_by_depth.get("1", []) if isinstance(up_by_depth, dict) else []
    d1_down = down_by_depth.get("1", []) if isinstance(down_by_depth, dict) else []

    upstream_items = [{"depth": 1, "nodes": [s] if isinstance(s, dict) else [{"name": str(s)}]} for s in d1_up]
    downstream_items = [{"depth": 1, "nodes": [s] if isinstance(s, dict) else [{"name": str(s)}]} for s in d1_down]

    risk = "LOW"
    total = len(d1_up) + len(d1_down)
    if total >= 10:
        risk = "CRITICAL"
    elif total >= 5:
        risk = "HIGH"
    elif total >= 2:
        risk = "MEDIUM"

    return {
        "target": {"name": target, "type": "unknown", "file": ""},
        "risk": risk,
        "summary": {
            "direct_upstream": len(d1_up),
            "direct_downstream": len(d1_down),
            "affected_processes": len(query_data.get("processes", [])),
        },
        "upstream": upstream_items,
        "downstream": downstream_items,
        "affected_processes": query_data.get("processes", []),
    }
