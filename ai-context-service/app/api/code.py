from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.config import settings
from app.core.audit_service import log_action
from app.core.auth_service import User, get_current_user
from app.core.code_read_service import CodeReadService

router = APIRouter(tags=["code"])


class CodeReadItem(BaseModel):
    app_id: str
    ref: str = "main"
    path: str
    start_line: int | None = None
    end_line: int | None = None


class CodeReadRequest(BaseModel):
    items: list[CodeReadItem]
    max_bytes_per_file: int | None = None


class LineRange(BaseModel):
    start: int
    end: int


class CodeReadResult(BaseModel):
    app_id: str
    repo_path: str
    ref: str
    path: str
    resolved_commit: str | None
    content: str
    truncated: bool
    line_range: LineRange


class CodeReadError(BaseModel):
    app_id: str
    path: str
    error: str


class CodeReadResponse(BaseModel):
    results: list[CodeReadResult]
    errors: list[CodeReadError]


@router.post("/code/read", response_model=CodeReadResponse)
async def read_code(
    body: CodeReadRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if len(body.items) > settings.CODE_READ_MAX_ITEMS:
        raise HTTPException(400, f"Batch size exceeds maximum ({settings.CODE_READ_MAX_ITEMS})")

    max_bytes = settings.CODE_READ_MAX_BYTES
    if body.max_bytes_per_file is not None:
        max_bytes = min(body.max_bytes_per_file, settings.CODE_READ_MAX_BYTES)

    items = [item.model_dump() for item in body.items]
    results, errors = await CodeReadService.read_batch(db, user, items, max_bytes)

    await log_action(
        db,
        user_id=user.id,
        action="code_read",
        target_type="batch",
        detail={
            "item_count": len(body.items),
            "success_count": len(results),
            "error_count": len(errors),
            "app_ids": [item.app_id for item in body.items],
        },
        source="api",
    )

    return CodeReadResponse(results=results, errors=errors)
