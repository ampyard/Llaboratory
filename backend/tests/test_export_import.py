import io
import json
import zipfile

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

MC_PAYLOAD = {
    "name": "gpt4",
    "base_url": "https://api.openai.com/v1",
    "model_snapshot": "gpt-4",
    "api_key_env": "OPENAI_API_KEY",
    "params": {"temperature": 0.7},
    "input_cost_per_1k": 0.01,
    "output_cost_per_1k": 0.03,
}

PLAN_PAYLOAD = {
    "name": "test-plan",
    "description": "A test plan",
    "version": {
        "model_config_id": None,
        "tool_version_ids": [],
        "system_prompt": "Be helpful",
        "user_prompt": "Do something",
    },
}


def _parse_zip(resp) -> dict:
    buf = io.BytesIO(resp.content)
    with zipfile.ZipFile(buf, "r") as zf:
        return json.loads(zf.read("export.json"))


def _export_zip(client, body=None):
    return client.post("/api/export", json=body or {})


# ── Export ──


def test_export_empty(client):
    resp = _export_zip(client)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    data = _parse_zip(resp)
    assert data["version"] == 2
    assert data["tools"] == []
    assert data["model_configs"] == []
    assert data["plans"] == []
    assert data["run_batches"] == []
    assert data["sessions"] == []
    assert data["events"] == []


def test_export_all_data(client):
    # Create tool
    t = client.post("/api/tools", json=TOOL_PAYLOAD).json()
    # Create model config
    mc = client.post("/api/model-configs", json=MC_PAYLOAD).json()
    # Create plan referencing them
    p_payload = {
        "name": "test-plan",
        "description": "desc",
        "version": {
            "model_config_id": mc["id"],
            "tool_version_ids": [t["versions"][0]["id"]],
            "system_prompt": "Be helpful",
            "user_prompt": "Do something",
        },
    }
    client.post("/api/plans", json=p_payload).json()

    resp = _export_zip(client)
    assert resp.status_code == 200
    data = _parse_zip(resp)

    assert len(data["tools"]) == 1
    assert data["tools"][0]["name"] == "search"
    assert len(data["tools"][0]["versions"]) == 1

    assert len(data["model_configs"]) == 1
    assert data["model_configs"][0]["name"] == "gpt4"

    assert len(data["plans"]) == 1
    assert data["plans"][0]["name"] == "test-plan"
    assert len(data["plans"][0]["versions"]) == 1
    assert data["plans"][0]["versions"][0]["model_config_name"] == "gpt4"
    assert len(data["plans"][0]["versions"][0]["tool_versions"]) == 1


def test_export_selection(client):
    t1 = client.post("/api/tools", json=TOOL_PAYLOAD).json()
    client.post("/api/tools", json={**TOOL_PAYLOAD, "name": "calc", "version": {"display_name": "calc"}}).json()

    # Export only first tool
    resp = _export_zip(client, {"tool_ids": [t1["id"]]})
    data = _parse_zip(resp)
    assert len(data["tools"]) == 1
    assert data["tools"][0]["name"] == "search"

    # Export specific entity types
    resp2 = _export_zip(client, {"tool_ids": [], "model_config_ids": [], "plan_ids": []})
    data2 = _parse_zip(resp2)
    assert data2["tools"] == []
    assert data2["model_configs"] == []
    assert data2["plans"] == []


# ── Import Check ──


def test_import_check_no_conflicts(client):
    data = {
        "version": 2, "exported_at": "2024-01-01T00:00:00Z",
        "tools": [{"name": "new-tool", "description": "", "tags": [], "versions": []}],
        "model_configs": [],
        "plans": [],
        "run_batches": [],
        "sessions": [],
        "events": [],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("export.json", json.dumps(data))
    buf.seek(0)

    resp = client.post("/api/import/check", files={"file": ("export.zip", buf, "application/zip")})
    assert resp.status_code == 200
    result = resp.json()
    assert result["has_conflicts"] is False
    assert result["conflicts"] == []


def test_import_check_with_conflicts(client):
    # Create a tool with the same name that will be in the import
    client.post("/api/tools", json=TOOL_PAYLOAD).json()

    data = {
        "version": 2, "exported_at": "2024-01-01T00:00:00Z",
        "tools": [{"name": "search", "description": "", "tags": [], "versions": []}],
        "model_configs": [],
        "plans": [],
        "run_batches": [],
        "sessions": [],
        "events": [],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("export.json", json.dumps(data))
    buf.seek(0)

    resp = client.post("/api/import/check", files={"file": ("export.zip", buf, "application/zip")})
    assert resp.status_code == 200
    result = resp.json()
    assert result["has_conflicts"] is True
    assert any(c["name"] == "search" for c in result["conflicts"])


# ── Import ──


def test_import_success(client):
    data = {
        "version": 2, "exported_at": "2024-01-01T00:00:00Z",
        "tools": [
            {
                "name": "imported-tool",
                "description": "Imported",
                "tags": ["test"],
                "versions": [{
                    "version_number": 1,
                    "display_name": "Imported Ver",
                    "model_facing_description": "desc",
                    "parameter_schema": {"type": "object", "properties": {}},
                    "response_mode": "static",
                    "static_response": {"ok": True},
                    "dynamic_code": None,
                    "dynamic_approved": 1,
                    "manual_config": '{"replay_default":true}',
                }],
            }
        ],
        "model_configs": [
            {
                "name": "imported-mc",
                "provider_kind": "openai_compatible",
                "base_url": "https://example.com",
                "model_snapshot": "gpt-4",
                "params": {},
                "api_key_env": "TEST_KEY",
                "input_cost_per_1k": 0.0,
                "output_cost_per_1k": 0.0,
            }
        ],
        "plans": [
            {
                "name": "imported-plan",
                "description": "Imported plan",
                "versions": [{
                    "original_id": "pv-1",
                    "version_number": 1,
                    "system_prompt": "Hello",
                    "user_prompt": "World",
                    "run_settings": {"repetitions": 1},
                    "model_config_name": "imported-mc",
                    "tool_versions": [{"tool_name": "imported-tool", "display_name": "Imported Ver", "position": 0}],
                }],
            }
        ],
        "run_batches": [],
        "sessions": [],
        "events": [],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("export.json", json.dumps(data))
    buf.seek(0)

    resp = client.post("/api/import", files={"file": ("export.zip", buf, "application/zip")}, data={"rename_map": "{}"})
    assert resp.status_code == 200
    result = resp.json()
    assert result["success"] is True
    assert result["imported_tools"] == 1
    assert result["imported_tool_versions"] == 1
    assert result["imported_model_configs"] == 1
    assert result["imported_plans"] == 1
    assert result["imported_plan_versions"] == 1
    assert result["imported_run_batches"] == 0
    assert result["imported_sessions"] == 0
    assert result["imported_events"] == 0

    # Verify data was actually imported
    tools = client.get("/api/tools").json()
    assert any(t["name"] == "imported-tool" for t in tools)
    mcs = client.get("/api/model-configs").json()
    assert any(m["name"] == "imported-mc" for m in mcs)
    plans = client.get("/api/plans").json()
    imported_plan = next(p for p in plans if p["name"] == "imported-plan")
    assert len(imported_plan["versions"]) == 1
    latest = imported_plan["versions"][-1]
    assert len(latest["tool_versions"]) == 1
    imported_tool = next(t for t in tools if t["name"] == "imported-tool")
    assert latest["tool_versions"][0]["tool_id"] == imported_tool["id"]


def test_import_with_conflict_rejected(client):
    # Pre-create a tool with the same name
    client.post("/api/tools", json=TOOL_PAYLOAD)

    data = {
        "version": 2, "exported_at": "2024-01-01T00:00:00Z",
        "tools": [{"name": "search", "description": "", "tags": [], "versions": []}],
        "model_configs": [], "plans": [],
        "run_batches": [], "sessions": [], "events": [],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("export.json", json.dumps(data))
    buf.seek(0)

    resp = client.post("/api/import", files={"file": ("export.zip", buf, "application/zip")}, data={"rename_map": "{}"})
    assert resp.status_code == 200
    result = resp.json()
    assert result["success"] is False
    assert len(result["conflicts"]) > 0


def test_import_with_rename(client):
    # Pre-create a tool with conflicting name
    client.post("/api/tools", json=TOOL_PAYLOAD)

    data = {
        "version": 2, "exported_at": "2024-01-01T00:00:00Z",
        "tools": [{"name": "search", "description": "", "tags": [], "versions": [{"version_number": 1, "display_name": "v1"}]}],
        "model_configs": [], "plans": [],
        "run_batches": [], "sessions": [], "events": [],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("export.json", json.dumps(data))
    buf.seek(0)

    rename_map = json.dumps({"tools": {"search": "search-renamed"}})
    resp = client.post("/api/import", files={"file": ("export.zip", buf, "application/zip")}, data={"rename_map": rename_map})
    assert resp.status_code == 200
    result = resp.json()
    assert result["success"] is True
    assert result["imported_tools"] == 1

    tools = client.get("/api/tools").json()
    assert any(t["name"] == "search-renamed" for t in tools)


def test_import_full_with_session_data(client):
    """Import a full export including sessions, events, and run batches."""
    export = {
        "version": 2,
        "exported_at": "2024-01-01T00:00:00Z",
        "tools": [{
            "name": "tool-a",
            "description": "", "tags": [],
            "versions": [{
                "version_number": 1,
                "display_name": "Tool A",
                "model_facing_description": "desc",
                "parameter_schema": {"type": "object", "properties": {}},
                "response_mode": "static",
                "static_response": {},
                "dynamic_code": None,
                "dynamic_approved": 1,
                "manual_config": '{"replay_default":true}',
            }],
        }],
        "model_configs": [{
            "name": "mc-a",
            "provider_kind": "openai_compatible",
            "base_url": "https://example.com",
            "model_snapshot": "gpt-4",
            "params": {},
            "api_key_env": "",
            "input_cost_per_1k": 0.0,
            "output_cost_per_1k": 0.0,
        }],
        "plans": [{
            "name": "plan-a",
            "description": "",
            "versions": [{
                "original_id": "pv-old-1",
                "version_number": 1,
                "system_prompt": "",
                "user_prompt": "",
                "run_settings": {"repetitions": 1},
                "model_config_name": "mc-a",
                "tool_versions": [{"tool_name": "tool-a", "display_name": "Tool A", "position": 0}],
            }],
        }],
        "run_batches": [{
            "original_id": "batch-old-1",
            "name": "batch-1",
            "requested_repetitions": 1,
            "status": "completed",
            "plan_version_id": "pv-old-1",
            "created_at": "2024-01-01T00:00:00+00:00",
            "started_at": "2024-01-01T00:01:00+00:00",
            "ended_at": "2024-01-01T00:02:00+00:00",
        }],
        "sessions": [{
            "original_id": "session-old-1",
            "plan_version_id": "pv-old-1",
            "batch_id": "batch-old-1",
            "batch_index": 0,
            "started_at": "2024-01-01T00:01:00+00:00",
            "ended_at": "2024-01-01T00:02:00+00:00",
            "status": "completed",
            "termination_reason": "max_turns",
            "tool_order_used": [],
            "totals": {"turns": 1, "cost_usd": 0.001},
        }],
        "events": [{
            "session_id": "session-old-1",
            "sequence_no": 1,
            "timestamp": "2024-01-01T00:01:00+00:00",
            "type": "session_start",
            "payload": {},
            "latency_ms": None,
            "token_usage": None,
            "tool_call_id": None,
        }, {
            "session_id": "session-old-1",
            "sequence_no": 2,
            "timestamp": "2024-01-01T00:02:00+00:00",
            "type": "session_end",
            "payload": {"reason": "max_turns"},
            "latency_ms": 5000,
            "token_usage": {"input_tokens": 100, "output_tokens": 50},
            "tool_call_id": None,
        }],
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("export.json", json.dumps(export))
    buf.seek(0)

    resp = client.post("/api/import", files={"file": ("export.zip", buf, "application/zip")}, data={"rename_map": "{}"})
    assert resp.status_code == 200
    result = resp.json()
    assert result["success"] is True
    assert result["imported_tools"] == 1
    assert result["imported_tool_versions"] == 1
    assert result["imported_model_configs"] == 1
    assert result["imported_plans"] == 1
    assert result["imported_plan_versions"] == 1
    assert result["imported_run_batches"] == 1
    assert result["imported_sessions"] == 1
    assert result["imported_events"] == 2

    # Verify sessions exist
    sessions = client.get("/api/sessions").json()
    assert len(sessions) == 1
    assert sessions[0]["status"] == "completed"


# ── Factory Reset ──


def test_roundtrip_export_import_preserves_tool_links(client):
    """Full round-trip: create via API, export, wipe, import, verify plan tools are linked."""
    client.post("/api/tools", json=TOOL_PAYLOAD).json()
    mc = client.post("/api/model-configs", json=MC_PAYLOAD).json()
    tools = client.get("/api/tools").json()
    tool = next(t for t in tools if t["name"] == "search")

    plan_resp = client.post("/api/plans", json={
        "name": "roundtrip-plan",
        "description": "",
        "version": {
            "model_config_id": mc["id"],
            "tool_version_ids": [tool["versions"][0]["id"]],
            "system_prompt": "Be helpful",
            "user_prompt": "Do the thing",
        },
    })
    assert plan_resp.status_code == 201

    export_resp = client.post("/api/export", json={})
    assert export_resp.status_code == 200
    data = _parse_zip(export_resp)
    assert len(data["tools"]) == 1
    assert len(data["plans"]) == 1

    # Wipe user data
    client.post("/api/factory-reset")
    assert len(client.get("/api/model-configs").json()) == 0
    assert len(client.get("/api/plans").json()) == 0

    # Import
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("export.json", json.dumps(data))
    buf.seek(0)

    import_resp = client.post("/api/import", files={"file": ("export.zip", buf, "application/zip")}, data={"rename_map": "{}"})
    assert import_resp.status_code == 200
    import_result = import_resp.json()
    assert import_result["success"] is True, f"Import failed: {import_result}"

    # Verify plan has tools linked
    plans = client.get("/api/plans").json()
    imported_plan = next(p for p in plans if p["name"] == "roundtrip-plan")
    latest = imported_plan["versions"][-1]
    assert len(latest["tool_versions"]) == 1, f"Expected 1 tool version, got {len(latest['tool_versions'])}"
    assert latest["tool_versions"][0]["display_name"] == "search"


def test_factory_reset(client):
    # Create some data
    client.post("/api/tools", json=TOOL_PAYLOAD)
    mc = client.post("/api/model-configs", json=MC_PAYLOAD).json()
    t = client.get("/api/tools").json()[0]
    client.post("/api/plans", json={
        "name": "test-plan", "description": "",
        "version": {
            "model_config_id": mc["id"],
            "tool_version_ids": [t["versions"][0]["id"]],
            "system_prompt": "", "user_prompt": "",
        },
    })

    assert len(client.get("/api/tools").json()) == 1
    assert len(client.get("/api/model-configs").json()) == 1
    assert len(client.get("/api/plans").json()) == 1

    resp = client.post("/api/factory-reset")
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # Built-in tools should remain (seeded in init_db)
    # but user-created tools, model configs, plans should be gone
    assert len(client.get("/api/model-configs").json()) == 0
    assert len(client.get("/api/plans").json()) == 0
