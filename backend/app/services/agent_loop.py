"""Core agent loop: drives one session from start to finish."""
from __future__ import annotations
import asyncio
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session as DBSession

from app.models import Session, Event, ToolVersion
from app.services.provider import assemble_response, ProviderError
from app.services.tool_executor import execute_tool, validate_args

# Global registry of SSE queues: session_id -> asyncio.Queue
_session_queues: dict[str, asyncio.Queue] = {}


def get_or_create_queue(session_id: str) -> asyncio.Queue:
    if session_id not in _session_queues:
        _session_queues[session_id] = asyncio.Queue()
    return _session_queues[session_id]


def remove_queue(session_id: str):
    _session_queues.pop(session_id, None)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _emit(
    db: DBSession,
    session_id: str,
    seq: int,
    event_type: str,
    payload: dict,
    latency_ms: int | None = None,
    token_usage: dict | None = None,
    tool_call_id: str | None = None,
) -> Event:
    event = Event(
        id=str(uuid.uuid4()),
        session_id=session_id,
        sequence_no=seq,
        timestamp=_utcnow(),
        type=event_type,
        payload=json.dumps(payload),
        latency_ms=latency_ms,
        token_usage=json.dumps(token_usage) if token_usage else None,
        tool_call_id=tool_call_id,
    )
    db.add(event)
    db.commit()

    # Push to SSE queue if connected
    q = _session_queues.get(session_id)
    if q:
        await q.put({
            "sequence_no": seq,
            "type": event_type,
            "payload": payload,
            "latency_ms": latency_ms,
            "token_usage": token_usage,
            "tool_call_id": tool_call_id,
        })

    return event


def _build_tool_defs(tool_versions: list[ToolVersion]) -> list[dict]:
    defs = []
    for tv in tool_versions:
        schema = json.loads(tv.parameter_schema) if isinstance(tv.parameter_schema, str) else tv.parameter_schema
        defs.append({
            "type": "function",
            "function": {
                "name": tv.display_name,
                "description": tv.model_facing_description,
                "parameters": schema,
            },
        })
    return defs


def _find_tool_version(name: str, tool_versions: list[ToolVersion]) -> ToolVersion | None:
    for tv in tool_versions:
        if tv.display_name == name:
            return tv
    return None


def _args_hash(args: dict) -> str:
    canonical = json.dumps(args, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


async def run_session(session_id: str, db_factory) -> None:
    """
    Runs the agent loop for one session.
    db_factory: callable returning a new DB session (needed since we're in a background task).
    """
    db: DBSession = db_factory()
    try:
        await _run(session_id, db)
    finally:
        db.close()
        remove_queue(session_id)


async def _run(session_id: str, db: DBSession) -> None:
    session: Session = db.get(Session, session_id)
    if session is None:
        return

    plan_version = session.plan_version
    mcs = json.loads(plan_version.model_config_snapshot)
    run_settings = json.loads(plan_version.run_settings)
    tool_versions: list[ToolVersion] = list(plan_version.tool_versions)

    # Resolve API key (ok to be empty for local models)
    api_key_env = mcs.get("api_key_env", "")

    max_turns: int = run_settings.get("max_turns", 20)
    max_tool_calls: int = run_settings.get("max_tool_calls", 50)
    timeout_seconds: int = run_settings.get("timeout_seconds", 300)

    # Update session to running
    session.status = "running"
    session.started_at = _utcnow()
    session.tool_order_used = json.dumps([tv.id for tv in tool_versions])
    db.commit()

    seq = 0
    total_turns = 0
    total_tool_calls = 0
    total_input_tokens = 0
    total_output_tokens = 0

    # Repeat-call guard: (tool_name, args_hash) -> consecutive_count
    repeat_tracker: dict[tuple, int] = {}
    last_tc_key: tuple | None = None

    # Per-session context for dynamic tools
    session_context: dict = {}

    wall_start = time.monotonic()

    await _emit(db, session_id, seq, "session_start", {
        "plan_version_id": plan_version.id,
        "model": mcs["model_snapshot"],
        "tool_count": len(tool_versions),
    })
    seq += 1

    # Build initial messages
    messages: list[dict] = []
    if plan_version.system_prompt:
        messages.append({"role": "system", "content": plan_version.system_prompt})
    messages.append({"role": "user", "content": plan_version.user_prompt})

    tool_defs = _build_tool_defs(tool_versions)
    model_params = json.loads(mcs.get("params") or "{}") if isinstance(mcs.get("params"), str) else (mcs.get("params") or {})

    termination_reason = "completed_no_tool_call"

    try:
        while total_turns < max_turns:
            # Check wall-clock timeout
            if time.monotonic() - wall_start > timeout_seconds:
                termination_reason = "timeout"
                await _emit(db, session_id, seq, "loop_guard_triggered", {"reason": "timeout"})
                seq += 1
                break

            total_turns += 1

            await _emit(db, session_id, seq, "model_request", {
                "messages": messages,
                "tools": tool_defs,
                "params": model_params,
            })
            seq += 1

            # Streaming deltas forwarded to SSE queue

            async def _stream_cb(kind: str, data: Any):
                q = _session_queues.get(session_id)
                if q:
                    await q.put({"type": "stream_delta", "kind": kind, "data": data})

            req_start = time.monotonic()
            try:
                response = await assemble_response(
                    base_url=mcs["base_url"],
                    api_key_env=mcs["api_key_env"],
                    model=mcs["model_snapshot"],
                    messages=messages,
                    tools=tool_defs,
                    params=dict(model_params),
                    stream_callback=_stream_cb,
                )
            except ProviderError as e:
                if e.retryable:
                    # Simple single retry after 2s
                    await asyncio.sleep(2)
                    try:
                        response = await assemble_response(
                            base_url=mcs["base_url"],
                            api_key_env=mcs["api_key_env"],
                            model=mcs["model_snapshot"],
                            messages=messages,
                            tools=tool_defs,
                            params=dict(model_params),
                        )
                    except ProviderError:
                        termination_reason = "errored"
                        await _emit(db, session_id, seq, "abort", {"error": str(e)})
                        seq += 1
                        break
                else:
                    termination_reason = "errored"
                    await _emit(db, session_id, seq, "abort", {"error": str(e)})
                    seq += 1
                    break

            latency_ms = int((time.monotonic() - req_start) * 1000)
            usage = response.get("token_usage", {})
            total_input_tokens += usage.get("input_tokens", 0)
            total_output_tokens += usage.get("output_tokens", 0)

            await _emit(
                db, session_id, seq, "model_response",
                {
                    "content_parts": response["content_parts"],
                    "finish_reason": response["finish_reason"],
                },
                latency_ms=latency_ms,
                token_usage=usage,
            )
            seq += 1

            finish_reason = response["finish_reason"]
            tool_calls = response["tool_calls"]

            if not tool_calls or finish_reason == "end_turn":
                termination_reason = "completed_no_tool_call"
                break

            if finish_reason == "length":
                termination_reason = "length"
                break

            # Build assistant message to append
            oai_tool_calls = [
                {
                    "id": tc["tool_call_id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["raw_args"]},
                }
                for tc in tool_calls
            ]
            assistant_msg: dict[str, Any] = {"role": "assistant", "content": None, "tool_calls": oai_tool_calls}
            # Include text content if present
            text_parts = [p["content"] for p in response["content_parts"] if p["type"] == "text"]
            if text_parts:
                assistant_msg["content"] = " ".join(text_parts)
            messages.append(assistant_msg)

            # Execute each tool call
            for tc in tool_calls:
                total_tool_calls += 1
                tc_id = tc["tool_call_id"]
                name = tc["name"]
                parsed_args = tc["parsed_args"]

                # Repeat-call guard
                tc_key = (name, _args_hash(parsed_args))
                if tc_key == last_tc_key:
                    repeat_tracker[tc_key] = repeat_tracker.get(tc_key, 0) + 1
                else:
                    repeat_tracker = {tc_key: 1}
                    last_tc_key = tc_key

                if repeat_tracker.get(tc_key, 0) >= 5:
                    termination_reason = "loop_guard"
                    await _emit(db, session_id, seq, "loop_guard_triggered", {
                        "reason": "repeat_call",
                        "tool": name,
                        "args_hash": tc_key[1],
                    })
                    seq += 1
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": json.dumps({"error": "Loop guard: repeated identical call detected"}),
                    })
                    continue

                # Emit tool_call event
                await _emit(db, session_id, seq, "tool_call", {
                    "name": name,
                    "parsed_args": parsed_args,
                    "raw_args": tc["raw_args"],
                }, tool_call_id=tc_id)
                seq += 1

                # Find tool version
                tv = _find_tool_version(name, tool_versions)
                if tv is None:
                    await _emit(db, session_id, seq, "hallucinated_tool_call", {
                        "name": name,
                        "args": parsed_args,
                    }, tool_call_id=tc_id)
                    seq += 1
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": json.dumps({"error": f"Unknown tool: '{name}'"}),
                    })
                    continue

                # Validate args
                param_schema = json.loads(tv.parameter_schema) if isinstance(tv.parameter_schema, str) else tv.parameter_schema
                errors = validate_args(param_schema, parsed_args)
                if errors:
                    err_payload = {"error": "Invalid arguments", "details": errors}
                    await _emit(db, session_id, seq, "tool_error", {
                        "name": name,
                        "args": parsed_args,
                        "errors": errors,
                    }, tool_call_id=tc_id)
                    seq += 1
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": json.dumps(err_payload),
                    })
                    continue

                # Execute tool
                static_response = tv.static_response if isinstance(tv.static_response, str) else json.dumps(tv.static_response)
                result, error = execute_tool(
                    response_mode=tv.response_mode,
                    static_response_raw=static_response,
                    dynamic_code=tv.dynamic_code,
                    dynamic_approved=tv.dynamic_approved,
                    args=parsed_args,
                    session_context=session_context,
                )

                if error:
                    await _emit(db, session_id, seq, "tool_error", {
                        "name": name,
                        "error": error,
                    }, tool_call_id=tc_id)
                    seq += 1
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": json.dumps({"error": error}),
                    })
                else:
                    await _emit(db, session_id, seq, "tool_result", {
                        "name": name,
                        "result": result,
                    }, tool_call_id=tc_id)
                    seq += 1
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": json.dumps(result),
                    })

                if total_tool_calls >= max_tool_calls:
                    termination_reason = "max_tool_calls"
                    break

            if termination_reason in ("max_tool_calls", "loop_guard"):
                break

        else:
            termination_reason = "max_turns"

    except Exception as e:
        termination_reason = "errored"
        await _emit(db, session_id, seq, "abort", {"error": str(e)})
        seq += 1

    wall_ms = int((time.monotonic() - wall_start) * 1000)
    input_cost = (total_input_tokens / 1000) * mcs.get("input_cost_per_1k", 0)
    output_cost = (total_output_tokens / 1000) * mcs.get("output_cost_per_1k", 0)
    cost_usd = input_cost + output_cost

    totals = {
        "turns": total_turns,
        "tool_calls": total_tool_calls,
        "input_tokens": total_input_tokens,
        "output_tokens": total_output_tokens,
        "cost_usd": round(cost_usd, 6),
        "wall_clock_ms": wall_ms,
    }

    await _emit(db, session_id, seq, "session_end", {
        "termination_reason": termination_reason,
        "totals": totals,
    })

    session.status = "completed" if termination_reason not in ("errored",) else "errored"
    if termination_reason == "timeout":
        session.status = "aborted"
    session.termination_reason = termination_reason
    session.ended_at = _utcnow()
    session.totals = json.dumps(totals)
    db.commit()

    # Signal SSE stream to close
    q = _session_queues.get(session_id)
    if q:
        await q.put(None)
