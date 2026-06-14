import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, ForeignKey, Text, Float, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


plan_version_tools = Table(
    "plan_version_tools",
    Base.metadata,
    Column("plan_version_id", String, ForeignKey("plan_versions.id", ondelete="CASCADE")),
    Column("tool_version_id", String, ForeignKey("tool_versions.id")),
    Column("position", Integer, nullable=False, default=0),
)


class Tool(Base):
    __tablename__ = "tools"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(Text, default="[]")  # JSON array of strings
    built_in: Mapped[bool] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    versions: Mapped[list["ToolVersion"]] = relationship(
        back_populates="tool", order_by="ToolVersion.version_number", cascade="all, delete-orphan"
    )


class ToolVersion(Base):
    __tablename__ = "tool_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    tool_id: Mapped[str] = mapped_column(String, ForeignKey("tools.id", ondelete="CASCADE"), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    display_name: Mapped[str] = mapped_column(String, nullable=False)
    model_facing_description: Mapped[str] = mapped_column(Text, default="")
    parameter_schema: Mapped[str] = mapped_column(Text, default='{"type":"object","properties":{}}')  # JSON Schema
    response_mode: Mapped[str] = mapped_column(String, default="static")  # static | dynamic | manual
    static_response: Mapped[str] = mapped_column(Text, default='{}')  # JSON
    dynamic_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    dynamic_approved: Mapped[int] = mapped_column(Integer, default=1)  # 0=pending approval, 1=approved (user-authored)
    manual_config: Mapped[str] = mapped_column(Text, default='{"replay_default":true}')

    tool: Mapped["Tool"] = relationship(back_populates="versions")


class ModelConfig(Base):
    __tablename__ = "model_configs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    provider_kind: Mapped[str] = mapped_column(String, default="openai_compatible")
    base_url: Mapped[str] = mapped_column(String, nullable=False)
    model_snapshot: Mapped[str] = mapped_column(String, nullable=False)
    params: Mapped[str] = mapped_column(Text, default='{}')  # JSON: temperature, top_p, seed, max_tokens, tool_choice
    api_key_env: Mapped[str] = mapped_column(String, nullable=False)
    input_cost_per_1k: Mapped[float] = mapped_column(Float, default=0.0)
    output_cost_per_1k: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    versions: Mapped[list["PlanVersion"]] = relationship(
        back_populates="plan", order_by="PlanVersion.version_number", cascade="all, delete-orphan"
    )


class PlanVersion(Base):
    __tablename__ = "plan_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    plan_id: Mapped[str] = mapped_column(String, ForeignKey("plans.id", ondelete="CASCADE"), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    model_config_snapshot: Mapped[str] = mapped_column(Text, nullable=False)  # frozen JSON copy
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    user_prompt: Mapped[str] = mapped_column(Text, default="")
    run_settings: Mapped[str] = mapped_column(
        Text,
        default='{"repetitions":1,"tool_order_strategy":"fixed","max_turns":20,"max_tool_calls":50,"timeout_seconds":300}',
    )

    plan: Mapped["Plan"] = relationship(back_populates="versions")
    tool_versions: Mapped[list["ToolVersion"]] = relationship(secondary=plan_version_tools)
    sessions: Mapped[list["Session"]] = relationship(back_populates="plan_version", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    plan_version_id: Mapped[str] = mapped_column(
        String, ForeignKey("plan_versions.id", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")
    termination_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    tool_order_used: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of tool_version_ids
    totals: Mapped[str] = mapped_column(Text, default="{}")  # JSON summary

    plan_version: Mapped["PlanVersion"] = relationship(back_populates="sessions")
    events: Mapped[list["Event"]] = relationship(
        back_populates="session", order_by="Event.sequence_no", cascade="all, delete-orphan"
    )


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    type: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[str] = mapped_column(Text, default="{}")  # typed JSON per event type
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_usage: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    tool_call_id: Mapped[str | None] = mapped_column(String, nullable=True)

    session: Mapped["Session"] = relationship(back_populates="events")
