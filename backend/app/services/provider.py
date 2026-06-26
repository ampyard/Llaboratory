"""OpenAI-compatible streaming provider adapter."""
from __future__ import annotations
import json
import os
import uuid
from typing import AsyncGenerator
import httpx


class ProviderError(Exception):
    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


async def stream_completion(
    base_url: str,
    api_key_env: str,
    model: str,
    messages: list[dict],
    tools: list[dict],
    params: dict,
) -> AsyncGenerator[dict, None]:
    """Yield raw SSE chunks from the provider."""
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
    
    payload: dict = {
        "model": model,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = params.pop("tool_choice", "auto")
    for k in ("temperature", "top_p", "seed", "max_tokens"):
        if k in params:
            payload[k] = params[k]

    url = base_url.rstrip("/") + "/chat/completions"
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code == 401:
                    raise ProviderError("Auth failure — check your API key env var", retryable=False)
                if resp.status_code == 400:
                    body = await resp.aread()
                    raise ProviderError(f"Bad request: {body.decode()}", retryable=False)
                if resp.status_code >= 500:
                    raise ProviderError(f"Provider 5xx: {resp.status_code}", retryable=True)
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
    """
    Stream the response and assemble into a normalized turn dict:
    {
        "content_parts": [{"type": "text"|"tool_call"|"reasoning", ...}],
        "finish_reason": "end_turn"|"tool_call"|"length"|"content_filter"|"error",
        "tool_calls": [{"tool_call_id", "name", "raw_args", "parsed_args"}],
        "token_usage": {"input_tokens", "output_tokens"},
        "dropped_params": [],
    }
    """
    text_buffer = ""
    # tool_call accumulation keyed by index
    tc_buffers: dict[int, dict] = {}
    finish_reason_raw = None
    token_usage: dict = {}
    reasoning_buffer = ""

    async for chunk in stream_completion(base_url, api_key_env, model, messages, tools, dict(params)):
        choice = (chunk.get("choices") or [{}])[0]
        delta = choice.get("delta", {})

        # Reasoning content (some providers)
        if delta.get("reasoning"):
            reasoning_buffer += delta["reasoning"]
            if stream_callback:
                await stream_callback("reasoning_delta", delta["reasoning"])

        # Text content
        if delta.get("content"):
            text_buffer += delta["content"]
            if stream_callback:
                await stream_callback("text_delta", delta["content"])

        # Tool call deltas
        for tc_delta in delta.get("tool_calls") or []:
            idx = tc_delta["index"]
            if idx not in tc_buffers:
                tc_buffers[idx] = {
                    "tool_call_id": tc_delta.get("id") or str(uuid.uuid4()),
                    "name": "",
                    "args_buffer": "",
                }
            if tc_delta.get("id"):
                tc_buffers[idx]["tool_call_id"] = tc_delta["id"]
            if tc_delta.get("function", {}).get("name"):
                tc_buffers[idx]["name"] += tc_delta["function"]["name"]
            if tc_delta.get("function", {}).get("arguments"):
                tc_buffers[idx]["args_buffer"] += tc_delta["function"]["arguments"]
                if stream_callback:
                    await stream_callback("tool_args_delta", {
                        "index": idx,
                        "name": tc_buffers[idx]["name"],
                        "delta": tc_delta["function"]["arguments"],
                    })

        if choice.get("finish_reason"):
            finish_reason_raw = choice["finish_reason"]

        # Usage (often in last chunk)
        if chunk.get("usage"):
            u = chunk["usage"]
            token_usage = {
                "input_tokens": u.get("prompt_tokens", 0),
                "output_tokens": u.get("completion_tokens", 0),
            }
            if u.get("reasoning_tokens"):
                token_usage["reasoning_tokens"] = u["reasoning_tokens"]

    # Normalize finish reason
    finish_map = {
        "stop": "end_turn",
        "tool_calls": "tool_call",
        "length": "length",
        "content_filter": "content_filter",
        None: "end_turn",
    }
    finish_reason = finish_map.get(finish_reason_raw, "end_turn")

    # Assemble tool calls
    tool_calls = []
    content_parts = []

    if reasoning_buffer:
        content_parts.append({"type": "reasoning", "content": reasoning_buffer})

    if text_buffer:
        content_parts.append({"type": "text", "content": text_buffer})

    for idx in sorted(tc_buffers.keys()):
        buf = tc_buffers[idx]
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
    }
