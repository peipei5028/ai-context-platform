import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL))
logger = logging.getLogger("ai-context-service")

app = FastAPI(title="AI Context Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    logger.info("AI Context Service starting")
    logger.info(f"REPOS_ROOT_DIR={settings.REPOS_ROOT_DIR}")
    logger.info(f"GITNEXUS_HOME={settings.GITNEXUS_HOME}")
    logger.info(f"GITNEXUS_SERVE_URL={settings.GITNEXUS_SERVE_URL}")

    # Self-check: mark all running/pending index jobs as failed
    from sqlalchemy import select, update
    from app.api.deps import get_session_factory
    from app.models.index_job import IndexJob

    session_factory = get_session_factory()
    async with session_factory() as db:
        stmt = (
            update(IndexJob)
            .where(IndexJob.status.in_(["running", "pending"]))
            .values(status="failed", cancel_reason="服务重启")
        )
        result = await db.execute(stmt)
        if result.rowcount > 0:
            logger.warning(f"Marked {result.rowcount} running/pending index jobs as failed (server restart)")
        await db.commit()


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


# Routers
from app.api.auth import router as auth_router  # noqa: E402
from app.api.systems import router as systems_router  # noqa: E402
from app.api.apps import router as apps_router  # noqa: E402
from app.api.index_jobs import router as index_jobs_router  # noqa: E402
from app.api.routes import router as routes_router  # noqa: E402
from app.api.impact import router as impact_router  # noqa: E402
from app.api.graph import router as graph_router  # noqa: E402
from app.api.documents import router as documents_router  # noqa: E402
from app.api.tokens import router as tokens_router  # noqa: E402
from app.api.admin import router as admin_router  # noqa: E402
from app.api.code import router as code_router  # noqa: E402

app.include_router(auth_router, prefix="/api/v1")
app.include_router(systems_router, prefix="/api/v1")
app.include_router(apps_router, prefix="/api/v1")
app.include_router(index_jobs_router, prefix="/api/v1")
app.include_router(routes_router, prefix="/api/v1")
app.include_router(impact_router, prefix="/api/v1")
app.include_router(graph_router, prefix="/api/v1")
app.include_router(documents_router, prefix="/api/v1")
app.include_router(tokens_router, prefix="/api/v1")
app.include_router(admin_router, prefix="/api/v1")
app.include_router(code_router, prefix="/api/v1")
