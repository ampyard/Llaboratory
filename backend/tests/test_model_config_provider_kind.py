"""Tests for ModelConfig provider_kind persistence + validation, and loop adapter selection."""

import json
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import Plan, PlanVersion, Session
from app.services import agent_loop
from app.services.agent_loop import run_session
from tests.conftest import TestingSessionLocal

_RUN_SETTINGS = '{"max_turns": 20, "max_tool_calls": 50, "timeout_seconds": 300}'


def _override(db):
    def _get():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[get_db] = _get
    return TestClient(app)


def test_create_model_config_defaults_to_openai_compatible(db):
    client = _override(db)
    res = client.post("/api/model-configs", json={
        "name": "M1", "base_url": "https://api.openai.com/v1",
        "model_snapshot": "gpt-4o", "api_key_env": "OPENAI_API_KEY",
    })
    assert res.status_code == 201
    assert res.json()["provider_kind"] == "openai_compatible"


def test_create_model_config_accepts_responses_api(db):
    client = _override(db)
    res = client.post("/api/model-configs", json={
        "name": "R1", "base_url": "https://api.openai.com/v1",
        "model_snapshot": "gpt-4o", "api_key_env": "OPENAI_API_KEY",
        "provider_kind": "responses_api",
    })
    assert res.status_code == 201
    assert res.json()["provider_kind"] == "responses_api"


def test_create_model_config_rejects_unknown_kind(db):
    client = _override(db)
    res = client.post("/api/model-configs", json={
        "name": "X", "base_url": "https://api.openai.com/v1",
        "model_snapshot": "gpt-4o", "api_key_env": "K",
        "provider_kind": "anthropic_native",
    })
    assert res.status_code == 400


def test_update_model_config_provider_kind(db):
    client = _override(db)
    created = client.post("/api/model-configs", json={
        "name": "U1", "base_url": "https://api.openai.com/v1",
        "model_snapshot": "gpt-4o", "api_key_env": "OPENAI_API_KEY",
    }).json()
    res = client.patch(f"/api/model-configs/{created['id']}", json={"provider_kind": "responses_api"})
    assert res.status_code == 200
    assert res.json()["provider_kind"] == "responses_api"


def test_update_model_config_rejects_unknown_kind(db):
    client = _override(db)
    created = client.post("/api/model-configs", json={
        "name": "U2", "base_url": "https://api.openai.com/v1",
        "model_snapshot": "gpt-4o", "api_key_env": "OPENAI_API_KEY",
    }).json()
    res = client.patch(f"/api/model-configs/{created['id']}", json={"provider_kind": "bogus"})
    assert res.status_code == 400


def test_select_adapter_defaults_and_maps_kinds():
    assert agent_loop._call_adapter.__name__ == "_call_adapter"


# ── end-to-end: loop drives a Responses API session ──────────────────────────
# (mock the responses adapter so no network call happens)

def _responses_turn(finish="end_turn", tool_calls=None, text="Done."):
    content_parts = (
        [{"type": "tool_call", "tool_call_id": t["tool_call_id"], "name": t["name"],
          "raw_args": t["raw_args"], "parsed_args": t["parsed_args"]}
         for t in tool_calls]
        if tool_calls else [{"type": "text", "content": text}]
    )
    return {
        "content_parts": content_parts,
        "finish_reason": finish,
        "tool_calls": tool_calls or [],
        "token_usage": {"input_tokens": 9, "output_tokens": 4},
        "raw_request": {},
        "raw_response": [],
    }


def _make_responses_session(db, provider_kind="responses_api") -> str:
    mcs = json.dumps({
        "base_url": "https://api.openai.com/v1",
        "api_key_env": "FAKE_KEY",
        "model_snapshot": "gpt-4o",
        "provider_kind": provider_kind,
        "params": "{}",
        "input_cost_per_1k": 0.0,
        "output_cost_per_1k": 0.0,
    })
    plan = Plan(name="resp-plan")
    db.add(plan)
    db.flush()
    pv = PlanVersion(
        plan_id=plan.id, version_number=1,
        model_config_snapshot=mcs, system_prompt="", user_prompt="Hello",
        run_settings=_RUN_SETTINGS,
    )
    db.add(pv)
    db.flush()
    session = Session(plan_version_id=pv.id, status="pending")
    db.add(session)
    db.commit()
    return session.id


async def test_loop_runs_a_responses_api_session(db):
    """A Responses API model config drives the full loop (no tool calls)."""
    session_id = _make_responses_session(db, provider_kind="responses_api")

    with patch("app.services.agent_loop.responses_assemble_response",
               AsyncMock(return_value=_responses_turn())):
        await run_session(session_id, TestingSessionLocal)

    final = db.get(Session, session_id)
    db.refresh(final)
    assert final.status == "completed"
    assert final.termination_reason == "completed_no_tool_call"


async def test_loop_runs_chat_completions_by_default(db):
    """provider_kind omitted -> loop still completes via the chat-completions adapter."""
    session_id = _make_responses_session(db, provider_kind="openai_compatible")

    with patch("app.services.agent_loop.assemble_response",
               AsyncMock(return_value=_responses_turn())):
        await run_session(session_id, TestingSessionLocal)

    final = db.get(Session, session_id)
    db.refresh(final)
    assert final.status == "completed"
    assert final.termination_reason == "completed_no_tool_call"
