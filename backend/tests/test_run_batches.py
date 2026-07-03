"""Run-batch (N-repetition) API tests (no real model calls)."""
import asyncio
from unittest.mock import AsyncMock, patch


def _no_tool_response():
    return {
        "content_parts": [{"type": "text", "content": "Done."}],
        "finish_reason": "end_turn",
        "tool_calls": [],
        "token_usage": {"input_tokens": 10, "output_tokens": 5},
        "raw_request": {},
        "raw_response": [],
    }


def _run_batch_with_mock_model(batch_id, db_factory):
    from app.services.batch_runner import run_batch
    with patch("app.services.agent_loop.assemble_response", AsyncMock(return_value=_no_tool_response())):
        asyncio.run(run_batch(batch_id, db_factory))


def _setup(client):
    tool = client.post("/api/tools", json={
        "name": "greet",
        "description": "",
        "tags": [],
        "version": {
            "display_name": "greet",
            "model_facing_description": "Greet the user",
            "parameter_schema": {"type": "object", "properties": {}},
            "response_mode": "static",
            "static_response": {"greeting": "hello"},
        },
    }).json()
    mc = client.post("/api/model-configs", json={
        "name": "m",
        "base_url": "https://api.openai.com/v1",
        "model_snapshot": "gpt-4o-mini",
        "api_key_env": "TEST_KEY",
    }).json()
    plan = client.post("/api/plans", json={
        "name": "p",
        "description": "",
        "version": {
            "model_config_id": mc["id"],
            "tool_version_ids": [tool["versions"][0]["id"]],
            "system_prompt": "",
            "user_prompt": "Hello",
            "run_settings": {"repetitions": 2},
        },
    }).json()
    pv_id = plan["versions"][0]["id"]
    return pv_id


def test_create_batch_defaults_to_run_settings_repetitions(client):
    pv_id = _setup(client)
    r = client.post("/api/run-batches", json={"plan_version_id": pv_id})
    assert r.status_code == 201
    batch = r.json()
    assert batch["requested_repetitions"] == 2

    sessions = client.get(f"/api/sessions?plan_version_id={pv_id}").json()
    assert len(sessions) == 2
    assert all(s["batch_id"] == batch["id"] for s in sessions)


def test_create_batch_with_explicit_repetitions_override(client):
    pv_id = _setup(client)
    r = client.post("/api/run-batches", json={"plan_version_id": pv_id, "repetitions": 5})
    batch = r.json()
    assert batch["requested_repetitions"] == 5


def test_create_batch_uses_provided_name(client):
    pv_id = _setup(client)
    r = client.post("/api/run-batches", json={"plan_version_id": pv_id, "name": "My custom run"})
    assert r.json()["name"] == "My custom run"


def test_create_batch_defaults_name_when_blank(client):
    pv_id = _setup(client)
    r = client.post("/api/run-batches", json={"plan_version_id": pv_id, "name": "   "})
    batch = r.json()
    assert batch["name"].startswith("Batch ")

    progress = client.get(f"/api/run-batches/{batch['id']}").json()
    assert progress["name"] == batch["name"]


def test_create_batch_bad_plan_version(client):
    r = client.post("/api/run-batches", json={"plan_version_id": "nonexistent"})
    assert r.status_code == 400


def test_batch_progress_endpoint(client):
    pv_id = _setup(client)
    batch = client.post("/api/run-batches", json={"plan_version_id": pv_id, "repetitions": 3}).json()
    r = client.get(f"/api/run-batches/{batch['id']}")
    assert r.status_code == 200
    progress = r.json()
    assert progress["requested_repetitions"] == 3
    assert progress["pending_count"] == 3
    assert len(progress["session_ids"]) == 3
    assert len(progress["sessions"]) == 3
    assert progress["sessions"][0]["batch_index"] == 0
    assert progress["sessions"][0]["status"] == "pending"


def test_batch_runs_sessions_sequentially(client):
    """Directly exercises the batch_runner orchestration (bypassing BackgroundTasks)."""
    from tests.conftest import TestingSessionLocal

    pv_id = _setup(client)
    batch = client.post("/api/run-batches", json={"plan_version_id": pv_id, "repetitions": 2}).json()

    _run_batch_with_mock_model(batch["id"], TestingSessionLocal)

    progress = client.get(f"/api/run-batches/{batch['id']}").json()
    assert progress["status"] == "completed"
    assert progress["completed_count"] == 2

    sessions = client.get(f"/api/sessions?plan_version_id={pv_id}").json()
    ended = [s["ended_at"] for s in sessions]
    started = [s["started_at"] for s in sessions]
    assert all(ended) and all(started)
    # sequential: session 2 should not have started before session 1 ended
    by_start = sorted(sessions, key=lambda s: s["started_at"])
    assert by_start[0]["ended_at"] <= by_start[1]["started_at"]


def test_abort_batch_marks_pending_sessions_aborted(client):
    pv_id = _setup(client)
    batch = client.post("/api/run-batches", json={"plan_version_id": pv_id, "repetitions": 3}).json()

    r = client.post(f"/api/run-batches/{batch['id']}/abort")
    assert r.status_code == 200
    assert r.json()["status"] == "aborted"

    r2 = client.post(f"/api/run-batches/{batch['id']}/abort")
    assert r2.status_code == 400


def test_batch_completes_after_direct_session_abort_mid_run(client):
    """Aborting a member session directly (not via batch abort) must not leave
    the batch stuck at 'running' once every session reaches a terminal state."""
    from tests.conftest import TestingSessionLocal
    from app.models import Session as SessionModel

    pv_id = _setup(client)
    batch = client.post("/api/run-batches", json={"plan_version_id": pv_id, "repetitions": 2}).json()
    session_ids = [s["id"] for s in client.get(f"/api/sessions?plan_version_id={pv_id}").json()]

    # Simulate: session 1 gets aborted directly (e.g. from SessionDetail) mid-run,
    # independent of the batch-level abort endpoint.
    db = TestingSessionLocal()
    s0 = db.get(SessionModel, session_ids[0])
    s0.status = "aborted"
    s0.termination_reason = "aborted"
    db.commit()
    db.close()

    _run_batch_with_mock_model(batch["id"], TestingSessionLocal)

    progress = client.get(f"/api/run-batches/{batch['id']}").json()
    assert progress["status"] == "completed"
    assert progress["pending_count"] == 0
    assert progress["running_count"] == 0


def test_get_batch_self_heals_stuck_running_status(client):
    """If a batch's sessions all finished but RunBatch.status never got updated
    (e.g. the background task died), GET /run-batches/{id} should repair it."""
    from tests.conftest import TestingSessionLocal
    from app.models import RunBatch, Session as SessionModel

    pv_id = _setup(client)
    batch = client.post("/api/run-batches", json={"plan_version_id": pv_id, "repetitions": 2}).json()
    session_ids = [s["id"] for s in client.get(f"/api/sessions?plan_version_id={pv_id}").json()]

    db = TestingSessionLocal()
    for sid in session_ids:
        s = db.get(SessionModel, sid)
        s.status = "completed"
    b = db.get(RunBatch, batch["id"])
    b.status = "running"  # simulate the stuck state
    db.commit()
    db.close()

    progress = client.get(f"/api/run-batches/{batch['id']}").json()
    assert progress["status"] == "completed"


def test_analysis_scoped_to_batch_id(client):
    from tests.conftest import TestingSessionLocal

    pv_id = _setup(client)
    batch1 = client.post("/api/run-batches", json={"plan_version_id": pv_id, "repetitions": 2}).json()
    _run_batch_with_mock_model(batch1["id"], TestingSessionLocal)

    batch2 = client.post("/api/run-batches", json={"plan_version_id": pv_id, "repetitions": 3}).json()
    _run_batch_with_mock_model(batch2["id"], TestingSessionLocal)

    all_stats = client.get(f"/api/analysis/plan-version/{pv_id}").json()
    assert all_stats["session_count"] == 5

    batch1_stats = client.get(f"/api/analysis/plan-version/{pv_id}?batch_id={batch1['id']}").json()
    assert batch1_stats["session_count"] == 2

    batch2_stats = client.get(f"/api/analysis/plan-version/{pv_id}?batch_id={batch2['id']}").json()
    assert batch2_stats["session_count"] == 3
