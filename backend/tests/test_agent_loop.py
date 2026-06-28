"""Unit tests for agent loop components (no real API calls)."""

import json
from unittest.mock import AsyncMock, patch


from app.models import Plan, PlanVersion, Session
from app.services.agent_loop import run_session
from app.services.provider import ProviderError
from app.services.tool_executor import execute_tool, validate_args
from tests.conftest import TestingSessionLocal

# ── helpers ──────────────────────────────────────────────────────────────────

_MCS = json.dumps({
    "base_url": "https://api.example.com/v1",
    "api_key_env": "FAKE_KEY",
    "model_snapshot": "test-model",
    "params": "{}",
    "input_cost_per_1k": 0.0,
    "output_cost_per_1k": 0.0,
})

_RUN_SETTINGS = json.dumps({
    "max_turns": 20,
    "max_tool_calls": 50,
    "timeout_seconds": 300,
})


def _make_session(db) -> str:
    plan = Plan(name="test-plan")
    db.add(plan)
    db.flush()

    pv = PlanVersion(
        plan_id=plan.id,
        version_number=1,
        model_config_snapshot=_MCS,
        system_prompt="",
        user_prompt="Hello",
        run_settings=_RUN_SETTINGS,
    )
    db.add(pv)
    db.flush()

    session = Session(plan_version_id=pv.id, status="pending")
    db.add(session)
    db.commit()
    return session.id


def _no_tool_response():
    return {
        "content_parts": [{"type": "text", "content": "Done."}],
        "finish_reason": "end_turn",
        "tool_calls": [],
        "token_usage": {"input_tokens": 10, "output_tokens": 5},
        "raw_request": {"model": "test-model", "messages": [{"role": "user", "content": "Hello"}], "stream": True, "stream_options": {"include_usage": True}},
        "raw_response": [{"choices": [{"delta": {"content": "Done."}, "finish_reason": "stop"}]}],
    }


def _tool_call_response(name="dummy_tool"):
    return {
        "content_parts": [],
        "finish_reason": "tool_call",
        "tool_calls": [{
            "tool_call_id": "tc-1",
            "name": name,
            "raw_args": "{}",
            "parsed_args": {},
        }],
        "token_usage": {"input_tokens": 10, "output_tokens": 5},
        "raw_request": {"model": "test-model", "messages": [{"role": "user", "content": "Hello"}], "stream": True, "stream_options": {"include_usage": True}},
        "raw_response": [{"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"name": name, "arguments": "{}"}}]}, "finish_reason": "tool_calls"}]}],
    }


# ── loop guard: abort ─────────────────────────────────────────────────────────

async def test_abort_during_tool_call_stops_loop(db):
    """Abort set after first tool_call event: loop catches abort before the second tool call runs."""
    session_id = _make_session(db)

    two_tc_response = {
        "content_parts": [],
        "finish_reason": "tool_call",
        "tool_calls": [
            {"tool_call_id": "tc-1", "name": "tool_a", "raw_args": "{}", "parsed_args": {}},
            {"tool_call_id": "tc-2", "name": "tool_b", "raw_args": "{}", "parsed_args": {}},
        ],
        "token_usage": {"input_tokens": 10, "output_tokens": 5},
    }

    import app.services.agent_loop as loop_module
    original_emit = loop_module._emit
    tool_call_emit_count = 0

    async def patched_emit(db_arg, sid, seq, event_type, payload, **kwargs):
        nonlocal tool_call_emit_count
        result = await original_emit(db_arg, sid, seq, event_type, payload, **kwargs)
        if event_type == "tool_call":
            tool_call_emit_count += 1
            if tool_call_emit_count == 1:
                # Simulate abort arriving while tc-1 is being processed
                abort_db = TestingSessionLocal()
                try:
                    s = abort_db.get(Session, session_id)
                    s.status = "aborted"
                    abort_db.commit()
                finally:
                    abort_db.close()
        return result

    with patch("app.services.agent_loop.assemble_response", AsyncMock(return_value=two_tc_response)):
        with patch("app.services.agent_loop._emit", patched_emit):
            await run_session(session_id, TestingSessionLocal)

    final = db.get(Session, session_id)
    db.refresh(final)
    assert final.status == "aborted"
    assert final.termination_reason == "aborted"
    # Only tc-1 emitted; tc-2's pre-check caught the abort before it ran
    assert tool_call_emit_count == 1


async def test_abort_during_model_call_no_tool_calls(db):
    """Abort set while the model call runs, model returns no tool calls: still aborts."""
    session_id = _make_session(db)

    async def mock_assemble(**kwargs):
        # Simulate abort arriving while the HTTP call was in flight
        abort_db = TestingSessionLocal()
        try:
            s = abort_db.get(Session, session_id)
            s.status = "aborted"
            abort_db.commit()
        finally:
            abort_db.close()
        # Model finishes cleanly with no tool calls — the old bug would mark this "completed"
        return _no_tool_response()

    with patch("app.services.agent_loop.assemble_response", mock_assemble):
        await run_session(session_id, TestingSessionLocal)

    final = db.get(Session, session_id)
    db.refresh(final)
    assert final.status == "aborted"
    assert final.termination_reason == "aborted"


async def test_abort_stops_loop_and_sets_status(db):
    """Abort set in DB mid-run: loop exits and final status is 'aborted'."""
    session_id = _make_session(db)
    model_call_count = 0

    async def mock_assemble(**kwargs):
        nonlocal model_call_count
        model_call_count += 1
        # Write abort via a separate DB connection (simulates the /abort endpoint)
        abort_db = TestingSessionLocal()
        try:
            s = abort_db.get(Session, session_id)
            s.status = "aborted"
            abort_db.commit()
        finally:
            abort_db.close()
        # Return tool calls so the loop would continue — abort check must stop it
        return _tool_call_response()

    with patch("app.services.agent_loop.assemble_response", mock_assemble):
        await run_session(session_id, TestingSessionLocal)

    db.refresh(db.get(Session, session_id))
    final = db.get(Session, session_id)
    assert final.status == "aborted"
    assert final.termination_reason == "aborted"
    # Model called once; the post-response abort check stopped the loop
    assert model_call_count == 1


async def test_abort_termination_reason_in_session_end_event(db):
    """session_end event carries termination_reason='aborted'."""
    session_id = _make_session(db)

    async def mock_assemble(**kwargs):
        abort_db = TestingSessionLocal()
        try:
            s = abort_db.get(Session, session_id)
            s.status = "aborted"
            abort_db.commit()
        finally:
            abort_db.close()
        return _tool_call_response()

    with patch("app.services.agent_loop.assemble_response", mock_assemble):
        await run_session(session_id, TestingSessionLocal)

    session = db.get(Session, session_id)
    db.refresh(session)
    end_event = next(
        e for e in session.events if e.type == "session_end"
    )
    payload = json.loads(end_event.payload)
    assert payload["termination_reason"] == "aborted"


# ── normal completion ─────────────────────────────────────────────────────────

async def test_normal_completion_sets_completed_status(db):
    """Model returns no tool calls → session ends as 'completed'."""
    session_id = _make_session(db)

    with patch("app.services.agent_loop.assemble_response", AsyncMock(return_value=_no_tool_response())):
        await run_session(session_id, TestingSessionLocal)

    final = db.get(Session, session_id)
    assert final.status == "completed"
    assert final.termination_reason == "completed_no_tool_call"


# ── error handling ────────────────────────────────────────────────────────────

async def test_provider_error_sets_errored_status(db):
    """Non-retryable ProviderError → session ends as 'errored'."""
    session_id = _make_session(db)

    async def mock_assemble(**kwargs):
        raise ProviderError("boom", retryable=False)

    with patch("app.services.agent_loop.assemble_response", mock_assemble):
        await run_session(session_id, TestingSessionLocal)

    final = db.get(Session, session_id)
    assert final.status == "errored"
    assert final.termination_reason == "errored"


# ── timeout ───────────────────────────────────────────────────────────────────

async def test_timeout_sets_aborted_status(db):
    """Timeout (timeout_seconds=-1 so it fires immediately) → status 'aborted'."""
    plan = Plan(name="timeout-plan")
    db.add(plan)
    db.flush()

    fast_settings = json.dumps({
        "max_turns": 20,
        "max_tool_calls": 50,
        "timeout_seconds": -1,  # always exceeded
    })
    pv = PlanVersion(
        plan_id=plan.id,
        version_number=1,
        model_config_snapshot=_MCS,
        system_prompt="",
        user_prompt="Hello",
        run_settings=fast_settings,
    )
    db.add(pv)
    db.flush()
    session = Session(plan_version_id=pv.id, status="pending")
    db.add(session)
    db.commit()

    with patch("app.services.agent_loop.assemble_response", AsyncMock(return_value=_no_tool_response())):
        await run_session(session.id, TestingSessionLocal)

    db.refresh(session)
    assert session.status == "aborted"
    assert session.termination_reason == "timeout"


# ── validate_args ────────────────────────────────────────────────────────────

def test_validate_args_valid():
    schema = {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    }
    errors = validate_args(schema, {"query": "hello"})
    assert errors == []


def test_validate_args_missing_required():
    schema = {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    }
    errors = validate_args(schema, {})
    assert len(errors) == 1
    assert "query" in errors[0]


def test_validate_args_wrong_type():
    schema = {"type": "object", "properties": {"n": {"type": "integer"}}}
    errors = validate_args(schema, {"n": "not-an-int"})
    assert len(errors) == 1


def test_validate_args_empty_schema():
    errors = validate_args({"type": "object", "properties": {}}, {"anything": True})
    assert errors == []


# ── execute_tool: static ─────────────────────────────────────────────────────

def test_static_tool_returns_dict():
    result, err = execute_tool(
        "static", '{"answer": 42}', None, 1, {}, {}
    )
    assert err is None
    assert result == {"answer": 42}


def test_static_tool_invalid_json_fallback():
    result, err = execute_tool("static", "plain text", None, 1, {}, {})
    assert err is None
    assert result == {"result": "plain text"}


# ── execute_tool: dynamic ────────────────────────────────────────────────────

def test_dynamic_tool_basic():
    code = "def respond(args, context):\n    return {'echo': args.get('msg')}"
    result, err = execute_tool("dynamic", "{}", code, 1, {"msg": "hi"}, {})
    assert err is None
    assert result == {"echo": "hi"}


def test_dynamic_tool_stateful():
    code = "def respond(args, context):\n    context['n'] = context.get('n', 0) + 1\n    return {'count': context['n']}"
    ctx = {}
    result1, _ = execute_tool("dynamic", "{}", code, 1, {}, ctx)
    result2, _ = execute_tool("dynamic", "{}", code, 1, {}, ctx)
    assert result1 == {"count": 1}
    assert result2 == {"count": 2}


def test_dynamic_tool_unapproved_blocked():
    code = "def respond(args, context): return {}"
    result, err = execute_tool("dynamic", "{}", code, 0, {}, {})
    assert err is not None
    assert "approval" in err.lower()


def test_dynamic_tool_no_code():
    result, err = execute_tool("dynamic", "{}", None, 1, {}, {})
    assert err is not None


def test_dynamic_tool_runtime_error():
    code = "def respond(args, context): raise ValueError('oops')"
    result, err = execute_tool("dynamic", "{}", code, 1, {}, {})
    assert err is not None
    assert "oops" in err


def test_dynamic_tool_compile_error():
    code = "def respond(args context):\n    pass"  # syntax error
    result, err = execute_tool("dynamic", "{}", code, 1, {}, {})
    assert err is not None


# ── raw I/O capture ─────────────────────────────────────────────────────────

async def test_model_request_event_contains_raw_payload(db):
    """model_request event includes raw_payload matching the provider request body."""
    session_id = _make_session(db)

    captured_response = _no_tool_response()

    with patch("app.services.agent_loop.assemble_response", AsyncMock(return_value=captured_response)):
        await run_session(session_id, TestingSessionLocal)

    session = db.get(Session, session_id)
    db.refresh(session)
    req_event = next(e for e in session.events if e.type == "model_request")
    payload = json.loads(req_event.payload)
    assert "raw_payload" in payload
    rp = payload["raw_payload"]
    assert rp["model"] == "test-model"
    assert rp["stream"] is True
    assert rp["stream_options"] == {"include_usage": True}
    assert rp["messages"] == [{"role": "user", "content": "Hello"}]


async def test_model_response_event_contains_raw_response(db):
    """model_response event includes raw_response with provider SSE chunks."""
    session_id = _make_session(db)

    captured_response = _no_tool_response()

    with patch("app.services.agent_loop.assemble_response", AsyncMock(return_value=captured_response)):
        await run_session(session_id, TestingSessionLocal)

    session = db.get(Session, session_id)
    db.refresh(session)
    resp_event = next(e for e in session.events if e.type == "model_response")
    payload = json.loads(resp_event.payload)
    assert "raw_response" in payload
    raw = payload["raw_response"]
    assert isinstance(raw, list)
    assert len(raw) >= 1
    # First chunk should have choices with a delta
    assert "choices" in raw[0]


async def test_model_request_raw_payload_includes_tools_and_tool_choice(db):
    """When tools are present, raw_payload includes tools and tool_choice."""
    plan = Plan(name="tools-plan")
    db.add(plan)
    db.flush()

    from app.models import Tool, ToolVersion
    tool = Tool(name="t")
    db.add(tool)
    db.flush()
    tv = ToolVersion(
        tool_id=tool.id,
        version_number=1,
        display_name="t",
        model_facing_description="A tool",
        parameter_schema='{"type":"object","properties":{}}',
        response_mode="static",
        static_response='{}',
    )
    db.add(tv)
    db.flush()

    pv = PlanVersion(
        plan_id=plan.id,
        version_number=1,
        model_config_snapshot=_MCS,
        system_prompt="",
        user_prompt="Hi",
        run_settings=_RUN_SETTINGS,
        tool_versions=[tv],
    )
    db.add(pv)
    db.flush()
    session = Session(plan_version_id=pv.id, status="pending")
    db.add(session)
    db.commit()

    captured_response = _no_tool_response()

    with patch("app.services.agent_loop.assemble_response", AsyncMock(return_value=captured_response)):
        await run_session(session.id, TestingSessionLocal)

    session = db.get(Session, session.id)
    db.refresh(session)
    req_event = next(e for e in session.events if e.type == "model_request")
    payload = json.loads(req_event.payload)
    rp = payload["raw_payload"]
    assert "tools" in rp
    assert rp["tool_choice"] == "auto"
    assert isinstance(rp["tools"], list)
    assert rp["tools"][0]["function"]["name"] == "t"


async def test_model_request_raw_payload_includes_params(db):
    """Extra params like temperature appear in raw_payload."""
    plan = Plan(name="params-plan")
    db.add(plan)
    db.flush()

    mcs_with_params = json.dumps({
        "base_url": "https://api.example.com/v1",
        "api_key_env": "FAKE_KEY",
        "model_snapshot": "test-model",
        "params": json.dumps({"temperature": 0.7, "max_tokens": 512}),
        "input_cost_per_1k": 0.0,
        "output_cost_per_1k": 0.0,
    })
    pv = PlanVersion(
        plan_id=plan.id,
        version_number=1,
        model_config_snapshot=mcs_with_params,
        system_prompt="",
        user_prompt="Hi",
        run_settings=_RUN_SETTINGS,
    )
    db.add(pv)
    db.flush()
    session = Session(plan_version_id=pv.id, status="pending")
    db.add(session)
    db.commit()

    captured_response = _no_tool_response()

    with patch("app.services.agent_loop.assemble_response", AsyncMock(return_value=captured_response)):
        await run_session(session.id, TestingSessionLocal)

    session = db.get(Session, session.id)
    db.refresh(session)
    req_event = next(e for e in session.events if e.type == "model_request")
    payload = json.loads(req_event.payload)
    rp = payload["raw_payload"]
    assert rp["temperature"] == 0.7
    assert rp["max_tokens"] == 512


# ── execute_tool: unknown mode ───────────────────────────────────────────────

def test_unknown_response_mode():
    result, err = execute_tool("banana", "{}", None, 1, {}, {})
    assert err is not None
    assert "banana" in err
