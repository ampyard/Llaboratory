from unittest.mock import AsyncMock, patch


MODEL_CONFIG_PAYLOAD = {
    "name": "GPT-4o Mini",
    "base_url": "https://openrouter.ai/api/v1",
    "model_snapshot": "openai/gpt-4o-mini",
    "api_key_env": "OPENROUTER_API_KEY",
    "input_cost_per_1k": 0.00015,
    "output_cost_per_1k": 0.0006,
    "params": {
        "temperature": 1,
        "max_tokens": 4096,
    },
}


def test_create_model_config(client):
    r = client.post("/api/model-configs", json=MODEL_CONFIG_PAYLOAD)
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "GPT-4o Mini"
    assert data["model_snapshot"] == "openai/gpt-4o-mini"
    assert data["base_url"] == "https://openrouter.ai/api/v1"
    assert data["api_key_env"] == "OPENROUTER_API_KEY"
    assert data["input_cost_per_1k"] == 0.00015
    assert data["output_cost_per_1k"] == 0.0006


def test_list_model_configs(client):
    client.post("/api/model-configs", json=MODEL_CONFIG_PAYLOAD)
    client.post("/api/model-configs", json={**MODEL_CONFIG_PAYLOAD, "name": "Claude Sonnet"})
    r = client.get("/api/model-configs")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_get_model_config(client):
    created = client.post("/api/model-configs", json=MODEL_CONFIG_PAYLOAD).json()
    r = client.get(f"/api/model-configs/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_get_model_config_not_found(client):
    r = client.get("/api/model-configs/nonexistent")
    assert r.status_code == 404


def test_update_model_config(client):
    created = client.post("/api/model-configs", json=MODEL_CONFIG_PAYLOAD).json()
    r = client.patch(
        f"/api/model-configs/{created['id']}",
        json={"name": "Updated Name", "temperature": 0.5},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Updated Name"


def test_delete_model_config(client):
    created = client.post("/api/model-configs", json=MODEL_CONFIG_PAYLOAD).json()
    r = client.delete(f"/api/model-configs/{created['id']}")
    assert r.status_code == 204

    # Verify it's deleted
    r = client.get(f"/api/model-configs/{created['id']}")
    assert r.status_code == 404


@patch("app.routers.model_configs.os.environ.get")
@patch("app.routers.model_configs.assemble_response", new_callable=AsyncMock)
def test_test_model_config_success(mock_assemble, mock_env_get, client):
    # Create a model config
    created = client.post("/api/model-configs", json=MODEL_CONFIG_PAYLOAD).json()

    # Mock environment variable to return a fake API key
    mock_env_get.return_value = "fake_api_key"

    # Mock the assemble_response to return a successful response
    mock_assemble.return_value = {
        "content_parts": [{"type": "text", "content": "test successful"}],
        "finish_reason": "end_turn",
        "tool_calls": [],
        "token_usage": {"input_tokens": 10, "output_tokens": 5},
    }

    # Test the model config
    r = client.post(f"/api/model-configs/{created['id']}/test-model")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["message"] == "Model configuration test successful"
    assert data["response"] == "test successful"
    assert data["token_usage"]["input_tokens"] == 10
    assert data["token_usage"]["output_tokens"] == 5


def test_test_model_config_not_found(client):
    r = client.post("/api/model-configs/nonexistent/test-model")
    assert r.status_code == 404


@patch("app.routers.model_configs.os.environ.get")
def test_test_model_config_missing_api_key(mock_env_get, client):
    # Create a model config
    created = client.post("/api/model-configs", json=MODEL_CONFIG_PAYLOAD).json()

    # Mock environment variable to return None
    mock_env_get.return_value = None

    # Test the model config
    r = client.post(f"/api/model-configs/{created['id']}/test-model")
    assert r.status_code == 400
    data = r.json()
    assert "API key environment variable" in data["detail"]
    assert "OPENROUTER_API_KEY" in data["detail"]


@patch("app.routers.model_configs.os.environ.get")
@patch("app.routers.model_configs.assemble_response", new_callable=AsyncMock)
def test_test_model_config_provider_error(mock_assemble, mock_env_get, client):
    from app.services.provider import ProviderError

    # Create a model config
    created = client.post("/api/model-configs", json=MODEL_CONFIG_PAYLOAD).json()

    # Mock environment variable to return a fake API key
    mock_env_get.return_value = "fake_api_key"

    # Mock the assemble_response to raise a ProviderError
    mock_assemble.side_effect = ProviderError("Auth failure — check your API key env var")

    # Test the model config
    r = client.post(f"/api/model-configs/{created['id']}/test-model")
    assert r.status_code == 400
    data = r.json()
    assert "Provider error" in data["detail"]
    assert "Auth failure" in data["detail"]


@patch("app.routers.model_configs.os.environ.get")
@patch("app.routers.model_configs.assemble_response", new_callable=AsyncMock)
def test_test_model_config_generic_error(mock_assemble, mock_env_get, client):
    # Create a model config
    created = client.post("/api/model-configs", json=MODEL_CONFIG_PAYLOAD).json()

    # Mock environment variable to return a fake API key
    mock_env_get.return_value = "fake_api_key"

    # Mock the assemble_response to raise a generic exception
    mock_assemble.side_effect = Exception("Something went wrong")

    # Test the model config
    r = client.post(f"/api/model-configs/{created['id']}/test-model")
    assert r.status_code == 500
    data = r.json()
    assert "Test failed" in data["detail"]
    assert "Something went wrong" in data["detail"]
