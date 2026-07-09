"""Tests for /analysis/tool/{tool_id} endpoint, specifically the calls_history field."""
import json
import uuid
from datetime import datetime, timezone

from app.database import Base
from app.models import Event, Plan, PlanVersion, Session, Tool, ToolVersion


TOOL_PAYLOAD = {
    "name": "search",
    "description": "A search tool",
    "tags": ["web"],
    "version": {
        "display_name": "search",
        "model_facing_description": "Search the web",
        "parameter_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
        "response_mode": "static",
        "static_response": {"results": ["foo", "bar"]},
    },
}

_MCS = json.dumps(
    {
        "base_url": "https://api.example.com/v1",
        "api_key_env": "FAKE_KEY",
        "model_snapshot": "test-model",
        "params": "{}",
        "input_cost_per_1k": 0.0,
        "output_cost_per_1k": 0.0,
    }
)

_RUN_SETTINGS = json.dumps(
    {"max_turns": 20, "max_tool_calls": 50, "timeout_seconds": 300}
)


def _make_plan_version(db):
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
    return pv


def _make_session(db, pv, status="completed"):
    session = Session(plan_version_id=pv.id, status=status)
    session.started_at = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    session.ended_at = datetime(2026, 1, 1, 12, 0, 5, tzinfo=timezone.utc)
    db.add(session)
    db.flush()
    return session


def _add_events(db, session_id, tool_display_name, args, result=None, error=None):
    """Insert a tool_call + tool_result/tool_error event pair into the DB."""
    tc_id = str(uuid.uuid4())
    ts = datetime(2026, 1, 1, 12, 0, 1, tzinfo=timezone.utc)

    call_ev = Event(
        id=str(uuid.uuid4()),
        session_id=session_id,
        sequence_no=1,
        timestamp=ts,
        type="tool_call",
        payload=json.dumps({"name": tool_display_name, "parsed_args": args, "raw_args": json.dumps(args)}),
        latency_ms=123,
        tool_call_id=tc_id,
    )
    db.add(call_ev)

    if error:
        err_ev = Event(
            id=str(uuid.uuid4()),
            session_id=session_id,
            sequence_no=2,
            timestamp=ts,
            type="tool_error",
            payload=json.dumps({"name": tool_display_name, "error": error}),
            latency_ms=None,
            tool_call_id=tc_id,
        )
        db.add(err_ev)
    else:
        res_ev = Event(
            id=str(uuid.uuid4()),
            session_id=session_id,
            sequence_no=2,
            timestamp=ts,
            type="tool_result",
            payload=json.dumps({"name": tool_display_name, "result": result}),
            latency_ms=None,
            tool_call_id=tc_id,
        )
        db.add(res_ev)

    db.commit()


def test_tool_stats_calls_history_success(client, db):
    """calls_history includes entries with args and output for successful tool calls."""
    # Create the tool
    tool_resp = client.post("/api/tools", json=TOOL_PAYLOAD).json()
    tool_id = tool_resp["id"]
    tool_display_name = tool_resp["versions"][0]["display_name"]

    pv = _make_plan_version(db)
    session = _make_session(db, pv)
    _add_events(db, session.id, tool_display_name, args={"query": "hello"}, result={"results": ["a"]})

    r = client.get(f"/api/analysis/tool/{tool_id}")
    assert r.status_code == 200
    data = r.json()

    assert "calls_history" in data
    assert len(data["calls_history"]) == 1
    entry = data["calls_history"][0]
    assert entry["status"] == "success"
    assert entry["args"] == {"query": "hello"}
    assert entry["output"] == {"results": ["a"]}
    assert entry["latency_ms"] == 123
    assert entry["session_id"] == session.id


def test_tool_stats_calls_history_error(client, db):
    """calls_history correctly records error status and error output."""
    tool_resp = client.post("/api/tools", json=TOOL_PAYLOAD).json()
    tool_id = tool_resp["id"]
    tool_display_name = tool_resp["versions"][0]["display_name"]

    pv = _make_plan_version(db)
    session = _make_session(db, pv)
    _add_events(db, session.id, tool_display_name, args={"query": "bad"}, error="Tool failed: timeout")

    r = client.get(f"/api/analysis/tool/{tool_id}")
    assert r.status_code == 200
    data = r.json()

    assert len(data["calls_history"]) == 1
    entry = data["calls_history"][0]
    assert entry["status"] == "error"
    assert "timeout" in entry["output"]
    assert entry["args"] == {"query": "bad"}


def test_tool_stats_calls_history_reverse_chronological(client, db):
    """calls_history is sorted most-recent first when a tool is called multiple times."""
    tool_resp = client.post("/api/tools", json=TOOL_PAYLOAD).json()
    tool_id = tool_resp["id"]
    tool_display_name = tool_resp["versions"][0]["display_name"]

    pv = _make_plan_version(db)

    # Session 1 (earlier)
    s1 = _make_session(db, pv)
    tc1_id = str(uuid.uuid4())
    early_ts = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
    db.add(Event(
        id=str(uuid.uuid4()), session_id=s1.id, sequence_no=1,
        timestamp=early_ts, type="tool_call",
        payload=json.dumps({"name": tool_display_name, "parsed_args": {"query": "first"}, "raw_args": '{"query":"first"}'}),
        latency_ms=100, tool_call_id=tc1_id,
    ))
    db.add(Event(
        id=str(uuid.uuid4()), session_id=s1.id, sequence_no=2,
        timestamp=early_ts, type="tool_result",
        payload=json.dumps({"name": tool_display_name, "result": {"r": 1}}),
        tool_call_id=tc1_id,
    ))

    # Session 2 (later)
    s2 = _make_session(db, pv)
    tc2_id = str(uuid.uuid4())
    late_ts = datetime(2026, 1, 2, 10, 0, 0, tzinfo=timezone.utc)
    db.add(Event(
        id=str(uuid.uuid4()), session_id=s2.id, sequence_no=1,
        timestamp=late_ts, type="tool_call",
        payload=json.dumps({"name": tool_display_name, "parsed_args": {"query": "second"}, "raw_args": '{"query":"second"}'}),
        latency_ms=200, tool_call_id=tc2_id,
    ))
    db.add(Event(
        id=str(uuid.uuid4()), session_id=s2.id, sequence_no=2,
        timestamp=late_ts, type="tool_result",
        payload=json.dumps({"name": tool_display_name, "result": {"r": 2}}),
        tool_call_id=tc2_id,
    ))
    db.commit()

    r = client.get(f"/api/analysis/tool/{tool_id}")
    assert r.status_code == 200
    history = r.json()["calls_history"]

    assert len(history) == 2
    # Most recent first
    assert history[0]["args"]["query"] == "second"
    assert history[1]["args"]["query"] == "first"


def test_tool_stats_calls_history_empty_when_no_sessions(client):
    """calls_history is an empty list when the tool has never been called."""
    tool_resp = client.post("/api/tools", json=TOOL_PAYLOAD).json()
    tool_id = tool_resp["id"]

    r = client.get(f"/api/analysis/tool/{tool_id}")
    assert r.status_code == 200
    assert r.json()["calls_history"] == []
