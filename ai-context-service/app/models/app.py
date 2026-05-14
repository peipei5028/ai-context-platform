from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, gen_id


class App(TimestampMixin, Base):
    __tablename__ = "apps"
    __table_args__ = (
        UniqueConstraint("system_id", "name", "deleted", name="uq_system_app_name"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=gen_id)
    system_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("systems.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    git_url: Mapped[str] = mapped_column(String(512), nullable=False)
    repo_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    tracked_branch: Mapped[str] = mapped_column(String(64), default="main")
    tech_stack: Mapped[str | None] = mapped_column(String(128), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    index_status: Mapped[str] = mapped_column(
        String(16), default="none"
    )  # none/pending/running/success/failed/cancelled
    version: Mapped[int] = mapped_column(Integer, default=1)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    last_indexed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_commit: Mapped[str | None] = mapped_column(String(40), nullable=True)

    system = relationship("System", back_populates="apps")
    index_jobs = relationship("IndexJob", back_populates="app", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="app", cascade="all, delete-orphan")
