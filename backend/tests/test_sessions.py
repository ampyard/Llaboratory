"""Session API tests (no real model calls — verifies create/list/get/abort/delete/audit)."""


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
        },
    }).json()
    pv_id = plan["versions"][0]["id"]
    return pv_id


def test_create_session(client):
    pv_id = _setup(client)
    r = client.post("/api/sessions", json={"plan_version_id": pv_id})
    assert r.status_code == 201
    data = r.json()
    assert data["status"] == "pending"
    assert data["plan_version_id"] == pv_id


def test_create_session_bad_plan_version(client):
    r = client.post("/api/sessions", json={"plan_version_id": "nonexistent"})
    assert r.status_code == 400


def test_list_sessions(client):
    pv_id = _setup(client)
    client.post("/api/sessions", json={"plan_version_id": pv_id})
    client.post("/api/sessions", json={"plan_version_id": pv_id})
    r = client.get("/api/sessions")
    assert r.status_code == 200
    assert len(r.json()) >= 2


def test_list_sessions_filter_by_plan_version(client):
    pv_id = _setup(client)
    pv_id2 = _setup(client)
    client.post("/api/sessions", json={"plan_version_id": pv_id})
    client.post("/api/sessions", json={"plan_version_id": pv_id2})
    r = client.get(f"/api/sessions?plan_version_id={pv_id}")
    assert r.status_code == 200
    assert all(s["plan_version_id"] == pv_id for s in r.json())


def test_get_session(client):
    pv_id = _setup(client)
    session = client.post("/api/sessions", json={"plan_version_id": pv_id}).json()
    r = client.get(f"/api/sessions/{session['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == session["id"]


def test_get_session_not_found(client):
    r = client.get("/api/sessions/nonexistent")
    assert r.status_code == 404


def test_abort_pending_session(client):
    pv_id = _setup(client)
    session = client.post("/api/sessions", json={"plan_version_id": pv_id}).json()
    # pending sessions can be aborted
    r = client.post(f"/api/sessions/{session['id']}/abort")
    assert r.status_code == 200
    assert r.json()["status"] == "aborted"


def test_abort_already_completed_fails(client):
    pv_id = _setup(client)
    session = client.post("/api/sessions", json={"plan_version_id": pv_id}).json()
    # Manually force status to completed
    from app.models import Session as SessionModel
    from tests.conftest import TestingSessionLocal
    db = TestingSessionLocal()
    s = db.get(SessionModel, session["id"])
    s.status = "completed"
    db.commit()
    db.close()

    r = client.post(f"/api/sessions/{session['id']}/abort")
    assert r.status_code == 400


async def test_session_run_continues_with_missing_env_var(client):
    """Running with a missing API key env var should NOT fail fast — local models are keyless."""
    import os

    pv_id = _setup(client)
    session = client.post("/api/sessions", json={"plan_version_id": pv_id}).json()
    session_id = session["id"]

    os.environ.pop("TEST_KEY", None)

    from app.services.agent_loop import run_session
    from tests.conftest import TestingSessionLocal

    await run_session(session_id, TestingSessionLocal)

    r = client.get(f"/api/sessions/{session_id}")
    assert "missing_env_var" not in (r.json().get("termination_reason") or "")


def _force_status(client, session_id: str, status: str):
    from app.models import Session as SessionModel
    from tests.conftest import TestingSessionLocal
    db = TestingSessionLocal()
    s = db.get(SessionModel, session_id)
    s.status = status
    db.commit()
    db.close()


def test_delete_session_creates_audit_log(client):
    pv_id = _setup(client)
    session = client.post("/api/sessions", json={"plan_version_id": pv_id}).json()
    sid = session["id"]
    _force_status(client, sid, "completed")

    r = client.request("DELETE", f"/api/sessions/{sid}", json={"reason": "test removal"})
    assert r.status_code == 200
    data = r.json()
    assert data["entity_type"] == "session"
    assert data["entity_id"] == sid
    assert data["action"] == "delete"
    assert data["reason"] == "test removal"
    assert "session" in data["snapshot"]
    assert "events" in data["snapshot"]

    r2 = client.get(f"/api/sessions/{sid}")
    assert r2.status_code == 404


def test_delete_session_no_reason(client):
    pv_id = _setup(client)
    session = client.post("/api/sessions", json={"plan_version_id": pv_id}).json()
    _force_status(client, session["id"], "completed")

    r = client.request("DELETE", f"/api/sessions/{session['id']}", json={"reason": ""})
    assert r.status_code == 200
    assert r.json()["reason"] == ""


def test_delete_running_session_fails(client):
    pv_id = _setup(client)
    session = client.post("/api/sessions", json={"plan_version_id": pv_id}).json()
    _force_status(client, session["id"], "running")

    r = client.request("DELETE", f"/api/sessions/{session['id']}", json={"reason": ""})
    assert r.status_code == 400


def test_delete_session_not_found(client):
    r = client.request("DELETE", "/api/sessions/nonexistent", json={"reason": ""})
    assert r.status_code == 404


def test_audit_logs_list(client):
    pv_id = _setup(client)
    session = client.post("/api/sessions", json={"plan_version_id": pv_id}).json()
    _force_status(client, session["id"], "completed")

    client.request("DELETE", f"/api/sessions/{session['id']}", json={"reason": "audit test"})

    r = client.get("/api/sessions/audit-logs")
    assert r.status_code == 200
    logs = r.json()
    assert len(logs) >= 1
    assert any(log["entity_id"] == session["id"] for log in logs)


def test_audit_logs_filter_by_entity_type(client):
    pv_id = _setup(client)
    session = client.post("/api/sessions", json={"plan_version_id": pv_id}).json()
    _force_status(client, session["id"], "completed")
    client.request("DELETE", f"/api/sessions/{session['id']}", json={"reason": ""})

    r = client.get("/api/sessions/audit-logs?entity_type=session")
    assert r.status_code == 200
    assert all(log["entity_type"] == "session" for log in r.json())
