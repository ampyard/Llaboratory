"""Tests for the Responses API provider adapter (no real network calls)."""

from unittest.mock import patch

import json

from app.services.responses_provider import (
    assemble_response,
    _map_messages_to_input,
    _map_tools_to_response_format,
)


# ── request mapping ───────────────────────────────────────────────────────────


def test_map_tools_to_response_format():
    tools = [{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the weather",
            "parameters": {"type": "object", "properties": {"city": {"type": "string"}}},
        },
    }]
    out = _map_tools_to_response_format(tools)
    assert out[0]["type"] == "function"
    assert out[0]["name"] == "get_weather"
    assert out[0]["parameters"]["properties"]["city"]["type"] == "string"


def test_map_messages_pulls_system_into_instructions():
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]
    instructions, items = _map_messages_to_input(messages)
    assert instructions == "You are helpful."
    assert items == [{"type": "message", "role": "user", "content": "Hi"}]


def test_map_messages_assistant_tool_calls_become_function_call_items():
    messages = [
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": "foo", "arguments": "{\"x\":1}"}},
        ]},
        {"role": "tool", "tool_call_id": "call_1", "content": "{\"result\": 9}"},
    ]
    instructions, items = _map_messages_to_input(messages)
    assert instructions == ""
    assert items[0]["type"] == "message"
    assert items[0]["role"] == "assistant"
    calls = items[0]["content"]
    assert calls[0]["type"] == "function_call"
    assert calls[0]["call_id"] == "call_1"
    assert calls[0]["name"] == "foo"
    assert json.loads(calls[0]["arguments"]) == {"x": 1}
    assert items[1]["type"] == "function_call_output"
    assert items[1]["call_id"] == "call_1"
    assert items[1]["output"] == '{"result": 9}'


def test_map_messages_multiple_system_messages_join():
    messages = [
        {"role": "system", "content": "A"},
        {"role": "system", "content": "B"},
        {"role": "user", "content": "x"},
    ]
    instructions, _ = _map_messages_to_input(messages)
    assert instructions == "A\n\nB"


# ── streaming parse → normalized turn ────────────────────────────────────────


def _patch_stream(events):
    """Patch responses_provider.stream_responses with a real async generator."""
    async def _gen(*args, **kwargs):
        for e in events:
            yield e
    return patch("app.services.responses_provider.stream_responses", _gen)


async def test_assemble_response_text_only():
    events = [
        {"type": "response.output_text.delta", "delta": "Hello"},
        {"type": "response.output_text.delta", "delta": " world"},
        {"type": "response.completed", "response": {
            "status": "completed",
            "usage": {"input_tokens": 11, "output_tokens": 3},
        }},
    ]
    with _patch_stream(events):
        resp = await assemble_response(
            base_url="https://api.openai.com/v1", api_key_env="FAKE",
            model="gpt-4o", messages=[{"role": "user", "content": "hi"}],
            tools=[], params={}, stream_callback=None,
        )
    assert resp["finish_reason"] == "end_turn"
    assert resp["tool_calls"] == []
    assert resp["content_parts"][0]["type"] == "text"
    assert resp["content_parts"][0]["content"] == "Hello world"
    assert resp["token_usage"] == {"input_tokens": 11, "output_tokens": 3}


async def test_assemble_response_tool_call_with_deltas():
    events = [
        {"type": "response.output_item.added", "item": {
            "type": "function_call", "call_id": "call_abc", "name": "lookup",
        }},
        {"type": "response.function_call_arguments.delta", "call_id": "call_abc", "delta": '{"q":'},
        {"type": "response.function_call_arguments.delta", "call_id": "call_abc", "delta": '"hi"}'},
        {"type": "response.completed", "response": {
            "status": "completed",
            "usage": {"input_tokens": 20, "output_tokens": 5, "reasoning_tokens": 2},
        }},
    ]
    with _patch_stream(events):
        resp = await assemble_response(
            base_url="https://api.openai.com/v1", api_key_env="FAKE",
            model="gpt-4o", messages=[{"role": "user", "content": "hi"}],
            tools=[{"type": "function", "function": {"name": "lookup", "parameters": {}}}],
            params={}, stream_callback=None,
        )
    assert resp["finish_reason"] == "tool_call"
    assert len(resp["tool_calls"]) == 1
    tc = resp["tool_calls"][0]
    assert tc["tool_call_id"] == "call_abc"
    assert tc["name"] == "lookup"
    assert tc["parsed_args"] == {"q": "hi"}
    assert resp["token_usage"].get("reasoning_tokens") == 2


async def test_assemble_response_length_finish_reason():
    events = [
        {"type": "response.output_text.delta", "delta": "partial"},
        {"type": "response.completed", "response": {
            "status": "incomplete",
            "incomplete_details": {"reason": "max_output_tokens"},
            "usage": {"input_tokens": 1, "output_tokens": 2},
        }},
    ]
    with _patch_stream(events):
        resp = await assemble_response(
            base_url="https://api.openai.com/v1", api_key_env="FAKE",
            model="gpt-4o", messages=[{"role": "user", "content": "hi"}],
            tools=[], params={}, stream_callback=None,
        )
    assert resp["finish_reason"] == "length"


async def test_assemble_response_stream_callback_fires():
    events = [
        {"type": "response.output_text.delta", "delta": "hi"},
        {"type": "response.completed", "response": {"status": "completed", "usage": {}}},
    ]
    seen = []
    async def cb(kind, data):
        seen.append((kind, data))

    with _patch_stream(events):
        await assemble_response(
            base_url="https://api.openai.com/v1", api_key_env="FAKE",
            model="gpt-4o", messages=[{"role": "user", "content": "hi"}],
            tools=[], params={}, stream_callback=cb,
        )
    assert any(kind == "text_delta" for kind, _ in seen)


async def test_assemble_response_tolerates_null_response_object():
    """LM Studio / some servers emit events with "response": null — must not crash."""
    events = [
        {"type": "response.created", "response": None},
        {"type": "response.output_text.delta", "delta": "hi"},
        {"type": "response.completed", "response": None},
    ]
    with _patch_stream(events):
        resp = await assemble_response(
            base_url="http://localhost:1234/v1", api_key_env="FAKE",
            model="llama", messages=[{"role": "user", "content": "hi"}],
            tools=[], params={}, stream_callback=None,
        )
    # No tool calls -> completion; null response just means no usage/status.
    assert resp["finish_reason"] == "end_turn"
    assert resp["content_parts"][0]["content"] == "hi"
    assert resp["token_usage"] == {}


async def test_assemble_response_null_response_with_text_completes():
    """response.created carries the object, completed is null (LM Studio quirk)."""
    events = [
        {"type": "response.created", "response": {"status": "in_progress", "id": "resp_1"}},
        {"type": "response.output_text.delta", "delta": "Hello"},
        {"type": "response.completed", "response": None},
    ]
    with _patch_stream(events):
        resp = await assemble_response(
            base_url="http://localhost:1234/v1", api_key_env="FAKE",
            model="llama", messages=[{"role": "user", "content": "hi"}],
            tools=[], params={}, stream_callback=None,
        )
    assert resp["finish_reason"] == "end_turn"
    assert resp["content_parts"][0]["content"] == "Hello"


async def test_assemble_response_error_event_raises_provider_error():
    """A streamed error event (LM Studio uses type:"error") surfaces as ProviderError."""
    from app.services.responses_provider import ProviderError
    events = [
        {"type": "response.created", "response": {"status": "in_progress"}},
        {"type": "error", "message": "tool 'foo' not supported"},
    ]
    with _patch_stream(events):
        try:
            await assemble_response(
                base_url="http://localhost:1234/v1", api_key_env="FAKE",
                model="llama", messages=[{"role": "user", "content": "hi"}],
                tools=[], params={}, stream_callback=None,
            )
            assert False, "expected ProviderError"
        except ProviderError as e:
            assert "tool 'foo' not supported" in str(e)
