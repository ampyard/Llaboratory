"""Analysis and aggregation endpoints."""
from __future__ import annotations
import json
from collections import defaultdict
from statistics import mean, stdev

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DBSession
import csv
import io

from app.database import get_db
from app.models import PlanVersion, Session

router = APIRouter(prefix="/analysis", tags=["analysis"])


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
def aggregate_plan_version(plan_version_id: str, db: DBSession = Depends(get_db)):
    pv = db.get(PlanVersion, plan_version_id)
    if not pv:
        raise HTTPException(404, "PlanVersion not found")

    sessions = pv.sessions
    if not sessions:
        return {"plan_version_id": plan_version_id, "session_count": 0, "metrics": []}

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

    def safe_stats(vals: list) -> dict:
        if not vals:
            return {"mean": None, "stdev": None, "min": None, "max": None}
        return {
            "mean": round(mean(vals), 4),
            "stdev": round(stdev(vals), 4) if len(vals) > 1 else 0,
            "min": min(vals),
            "max": max(vals),
        }

    return {
        "plan_version_id": plan_version_id,
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
def export_csv(plan_version_id: str, db: DBSession = Depends(get_db)):
    pv = db.get(PlanVersion, plan_version_id)
    if not pv:
        raise HTTPException(404, "PlanVersion not found")

    per_session = [_session_metrics(s) for s in pv.sessions]
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
