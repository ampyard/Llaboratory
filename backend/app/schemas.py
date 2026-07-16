from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel, field_validator
import json


# ── Tool ────────────────────────────────────────────────────────────────────

class ToolVersionIn(BaseModel):
    display_name: str
    model_facing_description: str = ""
    parameter_schema: dict = {"type": "object", "properties": {}}
    response_mode: str = "static"  # static | dynamic
    static_response: Any = {}
    dynamic_code: str | None = None

class ToolCreate(BaseModel):
    name: str
    description: str = ""
    tags: list[str] = []
    version: ToolVersionIn

class ToolUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None

class ToolVersionOut(BaseModel):
    id: str
    tool_id: str
    version_number: int
    created_at: datetime
    display_name: str
    model_facing_description: str
    parameter_schema: dict
    response_mode: str
    static_response: Any
    dynamic_code: str | None
    dynamic_approved: int

    model_config = {"from_attributes": True}

    @field_validator("parameter_schema", mode="before")
    @classmethod
    def parse_param_schema(cls, v):
        return json.loads(v) if isinstance(v, str) else v

    @field_validator("static_response", mode="before")
    @classmethod
    def parse_static_response(cls, v):
        return json.loads(v) if isinstance(v, str) else v

class ToolOut(BaseModel):
    id: str
    name: str
    description: str
    tags: list[str]
    built_in: bool
    created_at: datetime
    versions: list[ToolVersionOut]

    model_config = {"from_attributes": True}

    @field_validator("tags", mode="before")
    @classmethod
    def parse_tags(cls, v):
        return json.loads(v) if isinstance(v, str) else v

class ToolVersionNewIn(BaseModel):
    """Used when saving a new version of an existing tool."""
    display_name: str
    model_facing_description: str = ""
    parameter_schema: dict = {"type": "object", "properties": {}}
    response_mode: str = "static"
    static_response: Any = {}
    dynamic_code: str | None = None


# ── ModelConfig ──────────────────────────────────────────────────────────────

class ModelConfigCreate(BaseModel):
    name: str
    base_url: str
    model_snapshot: str
    api_key_env: str
    params: dict = {}
    input_cost_per_1k: float = 0.0
    output_cost_per_1k: float = 0.0
    provider_kind: str = "openai_compatible"

class ModelConfigUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    model_snapshot: str | None = None
    api_key_env: str | None = None
    params: dict | None = None
    input_cost_per_1k: float | None = None
    output_cost_per_1k: float | None = None
    provider_kind: str | None = None

# Allowed provider kinds. Extend here when shipping a new adapter.
PROVIDER_KINDS = {"openai_compatible", "responses_api"}


def _validate_provider_kind(kind: str | None) -> str | None:
    """Return the validated kind, or None. Raises ValueError on an unknown kind."""
    if kind is None:
        return None
    if kind not in PROVIDER_KINDS:
        raise ValueError(
            f"Unknown provider_kind '{kind}'. Allowed: {', '.join(sorted(PROVIDER_KINDS))}"
        )
    return kind

class ModelConfigOut(BaseModel):
    id: str
    name: str
    provider_kind: str
    base_url: str
    model_snapshot: str
    api_key_env: str
    params: dict
    input_cost_per_1k: float
    output_cost_per_1k: float
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("params", mode="before")
    @classmethod
    def parse_params(cls, v):
        return json.loads(v) if isinstance(v, str) else v


# ── Plan ─────────────────────────────────────────────────────────────────────

class RunSettings(BaseModel):
    repetitions: int = 1
    tool_order_strategy: str = "fixed"
    max_turns: int = 20
    max_tool_calls: int = 50
    timeout_seconds: int = 300

class PlanVersionCreate(BaseModel):
    model_config_id: str
    tool_version_ids: list[str]  # ordered
    system_prompt: str = ""
    user_prompt: str = ""
    run_settings: RunSettings = RunSettings()

class PlanCreate(BaseModel):
    name: str
    description: str = ""
    version: PlanVersionCreate

class PlanUpdate(BaseModel):
    name: str | None = None
    description: str | None = None

class PlanVersionOut(BaseModel):
    id: str
    plan_id: str
    version_number: int
    created_at: datetime
    model_config_snapshot: dict
    system_prompt: str
    user_prompt: str
    run_settings: RunSettings
    tool_versions: list[ToolVersionOut]

    model_config = {"from_attributes": True}

    @field_validator("model_config_snapshot", mode="before")
    @classmethod
    def parse_mcs(cls, v):
        return json.loads(v) if isinstance(v, str) else v

    @field_validator("run_settings", mode="before")
    @classmethod
    def parse_run_settings(cls, v):
        d = json.loads(v) if isinstance(v, str) else v
        return RunSettings(**d)

class PlanOut(BaseModel):
    id: str
    name: str
    description: str
    created_at: datetime
    versions: list[PlanVersionOut]

    model_config = {"from_attributes": True}


# ── Session ───────────────────────────────────────────────────────────────────

class SessionDeleteBody(BaseModel):
    reason: str = ""


class SessionCreate(BaseModel):
    plan_version_id: str

class SessionTotals(BaseModel):
    turns: int = 0
    tool_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    wall_clock_ms: int = 0

class EventOut(BaseModel):
    id: str
    session_id: str
    sequence_no: int
    timestamp: datetime
    type: str
    payload: dict
    latency_ms: int | None
    token_usage: dict | None
    tool_call_id: str | None

    model_config = {"from_attributes": True}

    @field_validator("payload", mode="before")
    @classmethod
    def parse_payload(cls, v):
        return json.loads(v) if isinstance(v, str) else v

    @field_validator("token_usage", mode="before")
    @classmethod
    def parse_token_usage(cls, v):
        if v is None:
            return None
        return json.loads(v) if isinstance(v, str) else v

class SessionOut(BaseModel):
    id: str
    plan_version_id: str
    batch_id: str | None = None
    batch_index: int = 0
    started_at: datetime | None
    ended_at: datetime | None
    status: str
    termination_reason: str | None
    tool_order_used: list[str]
    totals: dict

    model_config = {"from_attributes": True}

    @field_validator("tool_order_used", mode="before")
    @classmethod
    def parse_order(cls, v):
        return json.loads(v) if isinstance(v, str) else v

    @field_validator("totals", mode="before")
    @classmethod
    def parse_totals(cls, v):
        return json.loads(v) if isinstance(v, str) else v

class SessionDetailOut(SessionOut):
    events: list[EventOut]
    plan_version: PlanVersionOut


# ── RunBatch ──────────────────────────────────────────────────────────────────

# ── AuditLog ──────────────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    action: str
    reason: str
    snapshot: dict
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("snapshot", mode="before")
    @classmethod
    def parse_snapshot(cls, v):
        return json.loads(v) if isinstance(v, str) else v


# ── RunBatch ──────────────────────────────────────────────────────────────────

class RunBatchCreate(BaseModel):
    plan_version_id: str
    name: str = ""
    repetitions: int | None = None  # None => use plan_version.run_settings.repetitions

class RunBatchOut(BaseModel):
    id: str
    plan_version_id: str
    name: str
    requested_repetitions: int
    status: str
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None

    model_config = {"from_attributes": True}

class RunBatchSessionSummary(BaseModel):
    id: str
    batch_index: int
    status: str
    termination_reason: str | None
    totals: dict

    model_config = {"from_attributes": True}

    @field_validator("totals", mode="before")
    @classmethod
    def parse_totals(cls, v):
        return json.loads(v) if isinstance(v, str) else v

class RunBatchProgressOut(BaseModel):
    id: str
    plan_version_id: str
    name: str
    status: str
    requested_repetitions: int
    completed_count: int
    running_count: int
    pending_count: int
    current_session_id: str | None
    session_ids: list[str]
    sessions: list[RunBatchSessionSummary]
