"""OpenAI Responses API streaming provider adapter.

Implements the same normalized contract as ``provider.assemble_response``
(see ``app/services/provider.py``) but talks to the OpenAI
`/v1/responses` endpoint instead of Chat Completions. The agent loop keeps
building its message list in Chat-Completions shape (roles ``system`` /
``user`` / ``assistant`` / ``tool``), so this adapter converts that internal
representation to the Responses API input format and parses the Responses
stream back into the shared normalized turn dict.

Responses API specifics handled here:
- Input is a flat list of typed items (``message`` / ``function_call`` /
  ``function_call_output``) rather than Chat Completions role messages.
- System instructions are sent as ``instructions`` (not a message item).
- Tool calls stream as a ``response.output_item.added`` for the
  ``function_call`` item, then one or more ``response.function_call_arguments.delta``
  items carrying incremental argument JSON.
- Token usage arrives in ``response.completed`` as ``usage.input_tokens`` /
  ``usage.output_tokens`` (plus optional ``reasoning_tokens``).
- Native tool-calling: tool outputs are returned as ``function_call_output``
  items, so there is no ``tool_choice`` field.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any, AsyncGenerator

import httpx


class ProviderError(Exception):
    """Mirrors the error type in provider.py so the agent loop treats both identically."""

    def __init__(self, message: str, retryable: bool = False, headers: dict | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.headers = headers


# ── Request mapping (internal messages/tools -> Responses API) ──────────────


def _map_tools_to_response_format(tools: list[dict]) -> list[dict]:
    """Convert Chat-Completions-style tool defs to the Responses ``tools`` list."""
    out: list[dict] = []
    for t in tools:
        fn = t.get("function", {})
        out.append({
            "type": "function",
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "parameters": fn.get("parameters", {"type": "object", "properties": {}}),
        })
    return out


def _map_messages_to_input(messages: list[dict]) -> tuple[str, list[dict]]:
    """Return (instructions, input_items) from internal Chat-Completions messages.

    - Leading ``system`` messages become the ``instructions`` string.
    - ``user`` / ``tool`` messages become ``message`` / ``function_call_output``
      items.
    - ``assistant`` messages with tool calls become a ``message`` item carrying
      ``function_call`` outputs (their text content is dropped, matching how the
      loop rebuilds assistant turns).
    """
    instructions_parts: list[str] = []
    input_items: list[dict] = []

    for msg in messages:
        role = msg.get("role")
        if role == "system":
            content = msg.get("content")
            if content:
                instructions_parts.append(content if isinstance(content, str) else json.dumps(content))
            continue

        if role == "user":
            content = msg.get("content")
            text = content if isinstance(content, str) else json.dumps(content)
            if text:
                input_items.append({"type": "message", "role": "user", "content": text})
            continue

        if role == "assistant":
            tool_calls = msg.get("tool_calls")
            if tool_calls:
                calls = []
                for tc in tool_calls:
                    fn = tc.get("function", {})
                    raw_args = fn.get("arguments", "{}")
                    if not isinstance(raw_args, str):
                        raw_args = "{}"
                    calls.append({
                        "type": "function_call",
                        "call_id": tc.get("id") or str(uuid.uuid4()),
                        "name": fn.get("name", ""),
                        "arguments": raw_args,
                    })
                input_items.append({"type": "message", "role": "assistant", "content": calls})
            else:
                content = msg.get("content")
                text = content if isinstance(content, str) else json.dumps(content)
                if text:
                    input_items.append({"type": "message", "role": "assistant", "content": text})
            continue

        if role == "tool":
            tool_call_id = msg.get("tool_call_id")
            content = msg.get("content")
            output = content if isinstance(content, str) else json.dumps(content)
            input_items.append({
                "type": "function_call_output",
                "call_id": tool_call_id or str(uuid.uuid4()),
                "output": output,
            })
            continue

    instructions = "\n\n".join(p for p in instructions_parts if p)
    return instructions, input_items


# ── Streaming ───────────────────────────────────────────────────────────────


async def stream_responses(
    base_url: str,
    api_key_env: str,
    model: str,
    messages: list[dict],
    tools: list[dict],
    params: dict,
) -> AsyncGenerator[dict, None]:
    """Yield raw SSE events from the Responses API ``/responses`` stream."""
    api_key = os.environ.get(api_key_env, "")
    headers = {
        "Content-Type": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    # OpenRouter app attribution (https://openrouter.ai/docs/app-attribution)
    headers["HTTP-Referer"] = "https://llaboratory.ampyard.com/"
    headers["X-OpenRouter-Title"] = "Llaboratory"
    headers["X-OpenRouter-Categories"] = "roleplay"

    instructions, input_items = _map_messages_to_input(messages)

    payload: dict[str, Any] = {
        "model": model,
        "input": input_items,
        "stream": True,
        "tools": _map_tools_to_response_format(tools) if tools else [],
    }
    if instructions:
        payload["instructions"] = instructions
    # Pass through supported sampling params (drop unknown ones per PRD §8.1).
    for k in ("temperature", "top_p", "seed", "max_tokens"):
        if k in params:
            payload[k] = params[k]
    # Reasoning effort: the Responses API expresses reasoning control as a
    # nested `reasoning` object ({"effort": "low"|"medium"|"high"}). LM Studio
    # (and current OpenAI) read it from there, not as a bare `reasoning_effort`
    # field, so map it into that shape when present.
    effort = params.get("reasoning_effort")
    if effort:
        payload["reasoning"] = {"effort": effort}

    url = base_url.rstrip("/") + "/responses"
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code == 401:
                    raise ProviderError("Auth failure — check your API key env var", retryable=False, headers=dict(resp.headers))
                if resp.status_code == 400:
                    body = await resp.aread()
                    raise ProviderError(f"Bad request: {body.decode()}", retryable=False, headers=dict(resp.headers))
                if resp.status_code == 429:
                    body = await resp.aread()
                    msg = f"Too Many Requests: {resp.status_code}"
                    try:
                        body_text = body.decode()
                        if body_text:
                            msg = f"Too Many Requests: {body_text}"
                    except Exception:
                        pass
                    raise ProviderError(msg, retryable=True, headers=dict(resp.headers))
                if resp.status_code >= 500:
                    raise ProviderError(f"Provider 5xx: {resp.status_code}", retryable=True, headers=dict(resp.headers))
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        return
                    yield json.loads(data)
        except httpx.TimeoutException:
            raise ProviderError("Request timed out", retryable=True)
        except httpx.ConnectError as e:
            raise ProviderError(f"Connection failed: {e}", retryable=True)


async def assemble_response(
    base_url: str,
    api_key_env: str,
    model: str,
    messages: list[dict],
    tools: list[dict],
    params: dict,
    stream_callback=None,  # optional async callable(chunk_type, data)
) -> dict:
    """Stream a Responses API turn and assemble it into the normalized turn dict.

    Output shape matches ``provider.assemble_response`` so the agent loop is
    provider-agnostic:

        {
            "content_parts": [...],
            "finish_reason": "end_turn"|"tool_call"|"length"|"content_filter"|"error",
            "tool_calls": [{"tool_call_id", "name", "raw_args", "parsed_args"}],
            "token_usage": {"input_tokens", "output_tokens", ...},
            "raw_request": { ... },
            "raw_response": [ ... ],
        }
    """
    text_buffer = ""
    reasoning_buffer = ""
    # function-call accumulation keyed by call_id
    tc_buffers: dict[str, dict] = {}
    finish_reason_raw: str | None = None
    token_usage: dict = {}
    raw_events: list[dict] = []

    raw_request: dict = {
        "model": model,
        "input": _map_messages_to_input(messages)[1],
        "stream": True,
        "tools": _map_tools_to_response_format(tools) if tools else [],
    }
    instructions, _ = _map_messages_to_input(messages)
    if instructions:
        raw_request["instructions"] = instructions
    for k in ("temperature", "top_p", "seed", "max_tokens", "reasoning_effort"):
        if k in params:
            raw_request[k] = params[k]

    async for event in stream_responses(base_url, api_key_env, model, messages, tools, dict(params)):
        raw_events.append(event)
        etype = event.get("type")

        if etype == "response.created":
            resp = event.get("response") or {}
            incomplete = resp.get("incomplete_details") or {}
            if incomplete.get("reason") == "max_output_tokens":
                finish_reason_raw = "length"

        elif etype == "response.output_item.added":
            item = event.get("item") or {}
            if item.get("type") == "function_call":
                call_id = item.get("call_id") or str(uuid.uuid4())
                tc_buffers[call_id] = {
                    "tool_call_id": call_id,
                    "name": item.get("name", ""),
                    "args_buffer": item.get("arguments", "") or "",
                }

        elif etype == "response.function_call_arguments.delta":
            call_id = event.get("call_id")
            delta = event.get("delta", "")
            if call_id and call_id in tc_buffers and delta:
                tc_buffers[call_id]["args_buffer"] += delta
                if stream_callback:
                    await stream_callback("tool_args_delta", {
                        "index": call_id,
                        "name": tc_buffers[call_id]["name"],
                        "delta": delta,
                    })

        elif etype == "response.output_text.delta":
            delta = event.get("delta", "")
            if delta:
                text_buffer += delta
                if stream_callback:
                    await stream_callback("text_delta", delta)

        elif etype == "response.reasoning_text.delta":
            delta = event.get("delta", "")
            if delta:
                reasoning_buffer += delta
                if stream_callback:
                    await stream_callback("reasoning_delta", delta)

        elif etype == "response.completed":
            resp = event.get("response") or {}
            if not resp:
                # LM Studio (and some servers) emit a completion event with
                # "response": null even on a successful stream that already
                # delivered text/tool deltas. Don't treat that as a failure —
                # let the end-of-stream inference pick the finish reason.
                continue
            if "usage" in resp:
                u = resp.get("usage") or {}
                token_usage = {
                    "input_tokens": u.get("input_tokens", 0),
                    "output_tokens": u.get("output_tokens", 0),
                }
                if u.get("reasoning_tokens"):
                    token_usage["reasoning_tokens"] = u["reasoning_tokens"]

            # Override finish reason from completion status if not already set
            if finish_reason_raw is None:
                status = resp.get("status")
                if status == "incomplete":
                    reason = (resp.get("incomplete_details") or {}).get("reason")
                    if reason == "max_output_tokens":
                        finish_reason_raw = "length"
                    elif reason == "content_filter":
                        finish_reason_raw = "content_filter"
                    else:
                        finish_reason_raw = "error"
                else:
                    # Completed: decide based on whether tool calls were emitted.
                    finish_reason_raw = "tool_call" if tc_buffers else "end_turn"

        elif etype in ("response.failed", "error"):
            # A terminal provider error inside an otherwise-200 stream
            # (e.g. LM Studio emits {"type":"error","message":...} or a
            # response.failed with response.error). Raise so the agent loop
            # records the session as errored instead of swallowing it.
            msg = event.get("message") or event.get("error") or ""
            resp_err = (event.get("response") or {}).get("error")
            if isinstance(resp_err, dict):
                msg = resp_err.get("message") or resp_err.get("code") or msg
            raise ProviderError(
                f"Provider error: {msg}" if msg else "Provider returned an error event",
                retryable=False,
            )

    # Normalize finish reason
    finish_map = {
        "stop": "end_turn",
        "tool_calls": "tool_call",
        "tool_call": "tool_call",
        "length": "length",
        "content_filter": "content_filter",
        "error": "error",
        None: "end_turn",
    }
    finish_reason = finish_map.get(finish_reason_raw, "end_turn")
    if finish_reason_raw is None:
        # No completion event seen (e.g. stream closed early): infer from tool calls.
        finish_reason = "tool_call" if tc_buffers else "end_turn"

    # Assemble content parts + tool calls
    tool_calls = []
    content_parts = []

    if reasoning_buffer:
        content_parts.append({"type": "reasoning", "content": reasoning_buffer})

    if text_buffer:
        content_parts.append({"type": "text", "content": text_buffer})

    for call_id in sorted(tc_buffers.keys()):
        buf = tc_buffers[call_id]
        raw_args = buf["args_buffer"]
        try:
            parsed_args = json.loads(raw_args) if raw_args.strip() else {}
        except json.JSONDecodeError:
            parsed_args = {"_raw": raw_args}
        tc = {
            "tool_call_id": buf["tool_call_id"],
            "name": buf["name"],
            "raw_args": raw_args,
            "parsed_args": parsed_args,
        }
        tool_calls.append(tc)
        content_parts.append({"type": "tool_call", **tc})

    return {
        "content_parts": content_parts,
        "finish_reason": finish_reason,
        "tool_calls": tool_calls,
        "token_usage": token_usage,
        "raw_request": raw_request,
        "raw_response": raw_events,
    }
