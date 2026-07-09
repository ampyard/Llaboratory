"""Analysis and aggregation endpoints."""
from __future__ import annotations
import json
from collections import defaultdict
from datetime import timezone
from statistics import mean, stdev

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, PlainTextResponse
from sqlalchemy.orm import Session as DBSession
import csv
import io

from app.database import get_db
from app.models import PlanVersion, Session, Tool

router = APIRouter(prefix="/analysis", tags=["analysis"])


def safe_stats(vals: list) -> dict:
    if not vals:
        return {"mean": None, "stdev": None, "min": None, "max": None}
    return {
        "mean": round(mean(vals), 4),
        "stdev": round(stdev(vals), 4) if len(vals) > 1 else 0,
        "min": min(vals),
        "max": max(vals),
    }


def _session_metrics(session: Session) -> dict:
    events = session.events
    tool_calls: dict[str, int] = {}
    tool_sequence: list[str] = []
    hallucinated = 0
    errors = 0

    for ev in events:
        payload = json.loads(ev.payload) if isinstance(ev.payload, str) else ev.payload
        if ev.type == "tool_call":
            name = payload.get("name", "unknown")
            tool_calls[name] = tool_calls.get(name, 0) + 1
            tool_sequence.append(name)
        elif ev.type == "hallucinated_tool_call":
            hallucinated += 1
        elif ev.type == "tool_error":
            errors += 1

    totals = json.loads(session.totals) if isinstance(session.totals, str) else session.totals

    return {
        "session_id": session.id,
        "status": session.status,
        "termination_reason": session.termination_reason,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "any_tool_called": bool(tool_calls),
        "tool_calls": tool_calls,
        "tool_sequence": tool_sequence,
        "hallucinated_tool_calls": hallucinated,
        "tool_errors": errors,
        "turns": totals.get("turns", 0),
        "total_tool_calls": totals.get("tool_calls", 0),
        "input_tokens": totals.get("input_tokens", 0),
        "output_tokens": totals.get("output_tokens", 0),
        "cost_usd": totals.get("cost_usd", 0.0),
        "wall_clock_ms": totals.get("wall_clock_ms", 0),
        "first_tool": tool_sequence[0] if tool_sequence else None,
    }


@router.get("/plan-version/{plan_version_id}")
def aggregate_plan_version(plan_version_id: str, batch_id: str | None = None, db: DBSession = Depends(get_db)):
    pv = db.get(PlanVersion, plan_version_id)
    if not pv:
        raise HTTPException(404, "PlanVersion not found")

    sessions = pv.sessions
    if batch_id:
        sessions = [s for s in sessions if s.batch_id == batch_id]
    if not sessions:
        return {"plan_version_id": plan_version_id, "batch_id": batch_id, "session_count": 0, "metrics": []}

    per_session = [_session_metrics(s) for s in sessions]
    completed = [m for m in per_session if m["status"] == "completed"]
    errored = [m for m in per_session if m["status"] == "errored"]
    aborted = [m for m in per_session if m["status"] == "aborted"]

    n = len(per_session)

    tool_selection: dict[str, int] = defaultdict(int)
    first_tool_dist: dict[str, int] = defaultdict(int)
    for m in per_session:
        for name, count in m["tool_calls"].items():
            tool_selection[name] += count
        if m["first_tool"]:
            first_tool_dist[m["first_tool"]] += 1

    turns_vals = [m["turns"] for m in completed]
    cost_vals = [m["cost_usd"] for m in completed]
    token_vals = [m["input_tokens"] + m["output_tokens"] for m in completed]

    return {
        "plan_version_id": plan_version_id,
        "batch_id": batch_id,
        "session_count": n,
        "completed": len(completed),
        "errored": len(errored),
        "aborted": len(aborted),
        "no_tool_call_rate": sum(1 for m in per_session if not m["any_tool_called"]) / n,
        "tool_selection_counts": dict(tool_selection),
        "first_tool_distribution": dict(first_tool_dist),
        "turns_stats": safe_stats(turns_vals),
        "cost_usd_stats": safe_stats(cost_vals),
        "total_tokens_stats": safe_stats(token_vals),
        "per_session": per_session,
    }


@router.get("/plan-version/{plan_version_id}/export.csv")
def export_csv(plan_version_id: str, batch_id: str | None = None, db: DBSession = Depends(get_db)):
    pv = db.get(PlanVersion, plan_version_id)
    if not pv:
        raise HTTPException(404, "PlanVersion not found")

    sessions = pv.sessions
    if batch_id:
        sessions = [s for s in sessions if s.batch_id == batch_id]
    per_session = [_session_metrics(s) for s in sessions]
    if not per_session:
        return StreamingResponse(io.StringIO("no data"), media_type="text/csv")

    fields = [
        "session_id", "status", "termination_reason", "any_tool_called",
        "first_tool", "total_tool_calls", "hallucinated_tool_calls", "tool_errors",
        "turns", "input_tokens", "output_tokens", "cost_usd", "wall_clock_ms",
    ]

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(per_session)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=plan-{plan_version_id[:8]}.csv"},
    )


@router.get("/plan-version/{plan_version_id}/report.md", response_class=PlainTextResponse)
def export_report(plan_version_id: str, download: bool = False, batch_id: str | None = None, db: DBSession = Depends(get_db)):
    pv = db.get(PlanVersion, plan_version_id)
    if not pv:
        raise HTTPException(404, "PlanVersion not found")

    plan = pv.plan
    model_cfg = json.loads(pv.model_config_snapshot)
    run_settings = json.loads(pv.run_settings)

    sessions = pv.sessions
    if batch_id:
        sessions = [s for s in sessions if s.batch_id == batch_id]
    per_session = [_session_metrics(s) for s in sessions]

    n = len(per_session)
    completed = [m for m in per_session if m["status"] == "completed"]
    errored = [m for m in per_session if m["status"] == "errored"]
    aborted = [m for m in per_session if m["status"] == "aborted"]
    no_tool_call = [m for m in per_session if not m["any_tool_called"]]

    tool_selection: dict[str, int] = defaultdict(int)
    first_tool_dist: dict[str, int] = defaultdict(int)
    termination_counts: dict[str, int] = defaultdict(int)
    for m in per_session:
        for name, count in m["tool_calls"].items():
            tool_selection[name] += count
        if m["first_tool"]:
            first_tool_dist[m["first_tool"]] += 1
        if m["termination_reason"]:
            termination_counts[m["termination_reason"]] += 1

    turns_vals = [m["turns"] for m in completed]
    cost_vals = [m["cost_usd"] for m in completed]
    token_vals = [m["input_tokens"] + m["output_tokens"] for m in completed]

    def _stats_line(vals: list, fmt) -> str:
        if not vals:
            return "n/a"
        mn = fmt(mean(vals))
        lo = fmt(min(vals))
        hi = fmt(max(vals))
        sd = fmt(stdev(vals)) if len(vals) > 1 else fmt(0)
        return f"mean={mn}, min={lo}, max={hi}, stdev={sd}"

    # Collect run date range from session timestamps
    started_ats = [s.started_at for s in sessions if s.started_at]
    ended_ats = [s.ended_at for s in sessions if s.ended_at]
    run_range = ""
    if started_ats and ended_ats:
        first = min(started_ats).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        last = max(ended_ats).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        run_range = f"{first} — {last}"
    elif started_ats:
        run_range = min(started_ats).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Tool list from plan version
    tool_names = [tv.display_name for tv in pv.tool_versions]

    lines: list[str] = []

    lines += [
        f"# Findings Report — {plan.name}",
        "",
        f"**Plan version:** v{pv.version_number}  ",
        f"**Model:** `{model_cfg.get('model_snapshot', 'unknown')}`  ",
        f"**Provider:** {model_cfg.get('base_url', 'unknown')}  ",
        f"**Generated:** {__import__('datetime').datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}  ",
    ]
    if run_range:
        lines.append(f"**Sessions ran:** {run_range}  ")
    lines.append("")

    # Model params
    params = model_cfg.get("params", {})
    if isinstance(params, str):
        params = json.loads(params)
    param_bits = [f"`{k}={v}`" for k, v in params.items() if v is not None]
    if param_bits:
        lines += [f"**Sampling params:** {', '.join(param_bits)}  ", ""]

    lines += [
        "---",
        "",
        "## Experimental Setup",
        "",
        f"**Tools offered ({len(tool_names)}):** {', '.join(f'`{t}`' for t in tool_names) if tool_names else '_none_'}  ",
        f"**Tool order strategy:** {run_settings.get('tool_order_strategy', 'fixed')}  ",
        f"**Max turns per session:** {run_settings.get('max_turns', 20)}  ",
        f"**Max tool calls per session:** {run_settings.get('max_tool_calls', 50)}  ",
        "",
    ]

    if pv.system_prompt:
        lines += [
            "### System Prompt",
            "",
            "```",
            pv.system_prompt.strip(),
            "```",
            "",
        ]

    if pv.user_prompt:
        lines += [
            "### User / Starting Prompt",
            "",
            "```",
            pv.user_prompt.strip(),
            "```",
            "",
        ]

    lines += [
        "---",
        "",
        "## Session Outcomes",
        "",
        "| Metric | Count | Rate |",
        "|--------|-------|------|",
        f"| Total sessions | {n} | 100% |",
        f"| Completed | {len(completed)} | {len(completed)/n*100:.1f}% |" if n else "| Completed | 0 | — |",
        f"| Errored | {len(errored)} | {len(errored)/n*100:.1f}% |" if n else "| Errored | 0 | — |",
        f"| Aborted | {len(aborted)} | {len(aborted)/n*100:.1f}% |" if n else "| Aborted | 0 | — |",
        f"| No tool call | {len(no_tool_call)} | {len(no_tool_call)/n*100:.1f}% |" if n else "| No tool call | 0 | — |",
        "",
    ]

    if termination_counts:
        lines += [
            "### Termination Reasons",
            "",
            "| Reason | Count |",
            "|--------|-------|",
        ]
        for reason, count in sorted(termination_counts.items(), key=lambda x: -x[1]):
            lines.append(f"| `{reason}` | {count} |")
        lines.append("")

    if tool_selection:
        lines += [
            "---",
            "",
            "## Tool Selection",
            "",
            f"_Across all {n} session(s). Rates are calls per session._",
            "",
            "| Tool | Total Calls | Calls/Session |",
            "|------|-------------|---------------|",
        ]
        for tool, count in sorted(tool_selection.items(), key=lambda x: -x[1]):
            lines.append(f"| `{tool}` | {count} | {count/n:.2f} |")
        lines.append("")

        if first_tool_dist:
            lines += [
                "### First Tool Chosen",
                "",
                "| Tool | Sessions | Rate |",
                "|------|----------|------|",
            ]
            for tool, count in sorted(first_tool_dist.items(), key=lambda x: -x[1]):
                lines.append(f"| `{tool}` | {count} | {count/n*100:.1f}% |")
            lines.append("")

    if completed:
        lines += [
            "---",
            "",
            "## Performance Metrics",
            f"_(Completed sessions only, n={len(completed)})_",
            "",
            "| Metric | Mean | Min | Max | Stdev |",
            "|--------|------|-----|-----|-------|",
            f"| Turns | {mean(turns_vals):.1f} | {min(turns_vals)} | {max(turns_vals)} | {(stdev(turns_vals) if len(turns_vals) > 1 else 0):.2f} |",
            f"| Total tokens | {mean(token_vals):,.0f} | {min(token_vals):,} | {max(token_vals):,} | {(stdev(token_vals) if len(token_vals) > 1 else 0):,.0f} |",
            f"| Cost (USD) | ${mean(cost_vals):.5f} | ${min(cost_vals):.5f} | ${max(cost_vals):.5f} | ${(stdev(cost_vals) if len(cost_vals) > 1 else 0):.5f} |",
            "",
        ]

    lines += [
        "---",
        "",
        f"_Report generated by [Llaboratory](https://github.com/ampyard/Llaboratory) · plan version ID: `{plan_version_id}`_",
        "",
    ]

    content = "\n".join(lines)
    filename = f"{plan.name.lower().replace(' ', '-')}-v{pv.version_number}-report.md"
    headers = {"Content-Disposition": f"attachment; filename={filename}"} if download else {}
    return PlainTextResponse(
        content,
        media_type="text/markdown; charset=utf-8",
        headers=headers,
    )


@router.get("/tool/{tool_id}")
def aggregate_tool(tool_id: str, db: DBSession = Depends(get_db)):
    tool = db.get(Tool, tool_id)
    if not tool:
        raise HTTPException(404, "Tool not found")

    if not tool.versions:
        return {
            "tool_id": tool_id,
            "tool_name": tool.name,
            "session_count": 0,
            "tool_calls": 0,
            "tool_errors": 0,
            "hallucinated_tool_calls": 0,
            "per_session": [],
        }

    # Find all sessions that used any version of this tool (match by tool name in events)
    all_sessions = db.query(Session).all()

    per_session = []
    all_call_records: list[dict] = []
    tool_name_lower = tool.name.lower()
    tool_display_names = {tv.display_name.lower() for tv in tool.versions}

    for session in all_sessions:
        matched = False
        for ev in session.events:
            if ev.type in ("tool_call", "tool_error", "hallucinated_tool_call"):
                payload = json.loads(ev.payload) if isinstance(ev.payload, str) else ev.payload
                ev_name = (payload.get("name", "") or "").lower()
                if ev_name in tool_display_names or ev_name == tool_name_lower:
                    matched = True
                    break

        if matched:
            metrics, call_records = _session_metrics_for_tool(session, tool)
            if metrics:
                per_session.append(metrics)
                all_call_records.extend(call_records)

    if not per_session:
        return {
            "tool_id": tool_id,
            "tool_name": tool.name,
            "session_count": 0,
            "tool_calls": 0,
            "tool_errors": 0,
            "hallucinated_tool_calls": 0,
            "per_model": {},
            "per_session": [],
            "calls_history": [],
        }

    total_calls = sum(m["tool_calls"] for m in per_session)
    total_errors = sum(m["tool_errors"] for m in per_session)
    total_hallucinated = sum(m["hallucinated_tool_calls"] for m in per_session)
    all_latencies = [m["latency_ms"]["mean"] for m in per_session if m["tool_calls"] > 0]
    all_tokens = [m["total_tokens"] for m in per_session]

    # Aggregate per-model stats
    per_model: dict[str, dict] = {}
    for m in per_session:
        model = m["model_name"]
        if model not in per_model:
            per_model[model] = {"calls": 0, "errors": 0, "hallucinated": 0, "sessions": 0, "total_tokens": 0}
        per_model[model]["calls"] += m["tool_calls"]
        per_model[model]["errors"] += m["tool_errors"]
        per_model[model]["hallucinated"] += m["hallucinated_tool_calls"]
        per_model[model]["sessions"] += 1
        per_model[model]["total_tokens"] += m["total_tokens"]

    # Sort call history in reverse chronological order (most recent first)
    calls_history = sorted(
        all_call_records,
        key=lambda r: r["timestamp"] or "",
        reverse=True,
    )

    return {
        "tool_id": tool_id,
        "tool_name": tool.name,
        "session_count": len(per_session),
        "tool_calls": total_calls,
        "tool_errors": total_errors,
        "hallucinated_tool_calls": total_hallucinated,
        "error_rate": round(total_errors / total_calls, 4) if total_calls else 0,
        "latency_ms": {
            "mean": round(mean(all_latencies), 1) if all_latencies else 0,
            "min": round(min(all_latencies), 1) if all_latencies else 0,
            "max": round(max(all_latencies), 1) if all_latencies else 0,
        },
        "total_tokens_stats": safe_stats(all_tokens),
        "per_model": per_model,
        "per_session": per_session,
        "calls_history": calls_history,
    }


def _get_model_name(session: Session) -> str:
    """Extract model name from session's plan version snapshot."""
    try:
        pv = session.plan_version
        snapshot = json.loads(pv.model_config_snapshot) if isinstance(pv.model_config_snapshot, str) else pv.model_config_snapshot
        return snapshot.get("model_snapshot", "unknown")
    except Exception:
        return "unknown"


def _session_metrics_for_tool(session: Session, tool: Tool) -> tuple[dict | None, list[dict]]:
    """Return (per-session metrics, list of individual call records) for a specific tool.

    Returns (None, []) if tool was never called in this session.
    Each call record captures input args, output result/error, status and timing.
    """
    events = session.events
    tool_calls = 0
    tool_errors = 0
    tool_hallucinated = 0
    latencies: list[int] = []
    token_usage: list[dict] = []

    tool_name_lower = tool.name.lower()
    tool_display_names = {tv.display_name.lower() for tv in tool.versions}

    model_name = _get_model_name(session)

    # Build a map from tool_call_id -> call record so we can attach the result
    # after we see the corresponding tool_result / tool_error event.
    pending_calls: dict[str, dict] = {}  # tool_call_id -> partial record
    call_records: list[dict] = []

    for ev in events:
        payload = json.loads(ev.payload) if isinstance(ev.payload, str) else ev.payload
        ev_name = (payload.get("name", "") or "").lower()

        if ev_name not in tool_display_names and ev_name != tool_name_lower:
            continue

        if ev.type == "tool_call":
            tool_calls += 1
            if ev.latency_ms:
                latencies.append(ev.latency_ms)
            if ev.token_usage:
                tu = json.loads(ev.token_usage) if isinstance(ev.token_usage, str) else ev.token_usage
                token_usage.append(tu)

            record: dict = {
                "session_id": session.id,
                "model_name": model_name,
                "timestamp": ev.timestamp.isoformat() if ev.timestamp else None,
                "tool_call_id": ev.tool_call_id,
                "args": payload.get("parsed_args"),
                "output": None,
                "status": "success",  # optimistic; overwritten on error
                "latency_ms": ev.latency_ms,
            }
            call_records.append(record)
            if ev.tool_call_id:
                pending_calls[ev.tool_call_id] = record

        elif ev.type == "tool_error":
            tool_errors += 1
            # Try to attach the error to the matching call record
            matched = pending_calls.get(ev.tool_call_id or "") if ev.tool_call_id else None
            if matched:
                matched["status"] = "error"
                matched["output"] = payload.get("error") or payload.get("errors")
            else:
                # Standalone error record (e.g. schema validation before tool_call emitted)
                call_records.append({
                    "session_id": session.id,
                    "model_name": model_name,
                    "timestamp": ev.timestamp.isoformat() if ev.timestamp else None,
                    "tool_call_id": ev.tool_call_id,
                    "args": payload.get("args"),
                    "output": payload.get("error") or payload.get("errors"),
                    "status": "error",
                    "latency_ms": ev.latency_ms,
                })

        elif ev.type == "tool_result":
            matched = pending_calls.get(ev.tool_call_id or "") if ev.tool_call_id else None
            if matched:
                matched["output"] = payload.get("result")

        elif ev.type == "hallucinated_tool_call":
            tool_hallucinated += 1
            call_records.append({
                "session_id": session.id,
                "model_name": model_name,
                "timestamp": ev.timestamp.isoformat() if ev.timestamp else None,
                "tool_call_id": ev.tool_call_id,
                "args": payload.get("args"),
                "output": None,
                "status": "hallucinated",
                "latency_ms": ev.latency_ms,
            })

    if tool_calls == 0 and tool_errors == 0 and tool_hallucinated == 0:
        return None, []

    return {
        "session_id": session.id,
        "status": session.status,
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "model_name": model_name,
        "tool_calls": tool_calls,
        "tool_errors": tool_errors,
        "hallucinated_tool_calls": tool_hallucinated,
        "latency_ms": {
            "mean": round(mean(latencies), 1) if latencies else 0,
            "min": min(latencies) if latencies else 0,
            "max": max(latencies) if latencies else 0,
        },
        "total_tokens": sum(
            tu.get("input_tokens", 0) + tu.get("output_tokens", 0) for tu in token_usage
        ),
    }, call_records
