import json


def _make_tool(client):
    return client.post("/api/tools", json={
        "name": "search",
        "description": "",
        "tags": [],
        "version": {
            "display_name": "search",
            "model_facing_description": "Search",
            "parameter_schema": {"type": "object", "properties": {"q": {"type": "string"}}},
            "response_mode": "static",
            "static_response": {"results": []},
        },
    }).json()


def _make_model_config(client):
    return client.post("/api/model-configs", json={
        "name": "test-model",
        "base_url": "https://api.openai.com/v1",
        "model_snapshot": "gpt-4o-mini",
        "api_key_env": "OPENAI_API_KEY",
        "params": {"temperature": 0.5},
        "input_cost_per_1k": 0.15,
        "output_cost_per_1k": 0.6,
    }).json()


def _make_plan(client, tool_version_id, model_config_id):
    return client.post("/api/plans", json={
        "name": "test plan",
        "description": "A test plan",
        "version": {
            "model_config_id": model_config_id,
            "tool_version_ids": [tool_version_id],
            "system_prompt": "You are a helpful assistant.",
            "user_prompt": "Please search for cats.",
            "run_settings": {
                "repetitions": 1,
                "tool_order_strategy": "fixed",
                "max_turns": 10,
                "max_tool_calls": 20,
                "timeout_seconds": 120,
            },
        },
    })


def test_create_plan(client):
    tool = _make_tool(client)
    mc = _make_model_config(client)
    tv_id = tool["versions"][0]["id"]

    r = _make_plan(client, tv_id, mc["id"])
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "test plan"
    assert len(data["versions"]) == 1
    pv = data["versions"][0]
    assert pv["version_number"] == 1
    assert pv["system_prompt"] == "You are a helpful assistant."
    assert len(pv["tool_versions"]) == 1
    assert pv["model_config_snapshot"]["model_snapshot"] == "gpt-4o-mini"
    # Key env var name is stored (not the key value)
    assert pv["model_config_snapshot"]["api_key_env"] == "OPENAI_API_KEY"
    # No raw API key value should be present
    snapshot_str = json.dumps(pv["model_config_snapshot"])
    assert "sk-" not in snapshot_str


def test_model_config_frozen_by_value(client):
    tool = _make_tool(client)
    mc = _make_model_config(client)
    tv_id = tool["versions"][0]["id"]

    plan = _make_plan(client, tv_id, mc["id"]).json()

    # Mutate the source model config
    client.patch(f"/api/model-configs/{mc['id']}", json={"model_snapshot": "gpt-4o"})

    # Frozen snapshot must remain unchanged
    refreshed = client.get(f"/api/plans/{plan['id']}").json()
    assert refreshed["versions"][0]["model_config_snapshot"]["model_snapshot"] == "gpt-4o-mini"


def test_list_plans(client):
    tool = _make_tool(client)
    mc = _make_model_config(client)
    tv_id = tool["versions"][0]["id"]

    _make_plan(client, tv_id, mc["id"])
    _make_plan(client, tv_id, mc["id"])
    r = client.get("/api/plans")
    assert r.status_code == 200
    # at least 2 plans (may have more from other tests if isolation is incomplete)
    assert len(r.json()) >= 2


def test_add_plan_version(client):
    tool = _make_tool(client)
    mc = _make_model_config(client)
    tv_id = tool["versions"][0]["id"]

    plan = _make_plan(client, tv_id, mc["id"]).json()
    plan_id = plan["id"]

    r = client.post(f"/api/plans/{plan_id}/versions", json={
        "model_config_id": mc["id"],
        "tool_version_ids": [tv_id],
        "system_prompt": "Updated system prompt",
        "user_prompt": "Updated user prompt",
        "run_settings": {"repetitions": 3},
    })
    assert r.status_code == 201
    assert r.json()["version_number"] == 2
    assert r.json()["system_prompt"] == "Updated system prompt"

    plan_detail = client.get(f"/api/plans/{plan_id}").json()
    assert len(plan_detail["versions"]) == 2


def test_bad_tool_version_id(client):
    mc = _make_model_config(client)
    r = client.post("/api/plans", json={
        "name": "bad plan",
        "description": "",
        "version": {
            "model_config_id": mc["id"],
            "tool_version_ids": ["nonexistent-id"],
            "system_prompt": "",
            "user_prompt": "hello",
        },
    })
    assert r.status_code == 400


def test_clone_plan(client):
    tool = _make_tool(client)
    mc = _make_model_config(client)
    tv_id = tool["versions"][0]["id"]
    plan = _make_plan(client, tv_id, mc["id"]).json()
    plan_id = plan["id"]

    r = client.post(f"/api/plans/{plan_id}/clone")
    assert r.status_code == 201
    clone = r.json()

    assert clone["name"] == "test plan_clone"
    assert clone["description"] == "A test plan"
    assert len(clone["versions"]) == 1
    pv = clone["versions"][0]
    assert pv["version_number"] == 1
    assert pv["system_prompt"] == "You are a helpful assistant."
    assert pv["user_prompt"] == "Please search for cats."
    assert len(pv["tool_versions"]) == 1
    assert pv["model_config_snapshot"]["model_snapshot"] == "gpt-4o-mini"

    # Original still exists
    assert client.get(f"/api/plans/{plan_id}").status_code == 200


def test_delete_plan(client):
    tool = _make_tool(client)
    mc = _make_model_config(client)
    plan = _make_plan(client, tool["versions"][0]["id"], mc["id"]).json()
    r = client.delete(f"/api/plans/{plan['id']}")
    assert r.status_code == 204
    assert client.get(f"/api/plans/{plan['id']}").status_code == 404


def test_update_plan_metadata(client):
    tool = _make_tool(client)
    mc = _make_model_config(client)
    plan = _make_plan(client, tool["versions"][0]["id"], mc["id"]).json()
    plan_id = plan["id"]

    # Update metadata
    r = client.patch(f"/api/plans/{plan_id}", json={
        "name": "Updated Plan Name",
        "description": "Updated Description"
    })
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Updated Plan Name"
    assert data["description"] == "Updated Description"

    # Get plan and check
    refreshed = client.get(f"/api/plans/{plan_id}").json()
    assert refreshed["name"] == "Updated Plan Name"
    assert refreshed["description"] == "Updated Description"

    # Try non-existent plan
    r = client.patch("/api/plans/nonexistent-id", json={"name": "New Name"})
    assert r.status_code == 404
