from __future__ import annotations
import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DBSession

from app.database import get_db, SessionLocal
from app.models import Session, PlanVersion, AuditLog
from app.schemas import SessionCreate, SessionOut, SessionDetailOut, EventOut, SessionDeleteBody, AuditLogOut
from app.services.agent_loop import run_session, get_or_create_queue

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionOut])
def list_sessions(
    plan_version_id: str | None = None,
    status: str | None = None,
    db: DBSession = Depends(get_db),
):
    q = db.query(Session)
    if plan_version_id:
        q = q.filter(Session.plan_version_id == plan_version_id)
    if status:
        q = q.filter(Session.status == status)
    return q.order_by(Session.started_at.desc()).all()


@router.get("/audit-logs", response_model=list[AuditLogOut])
def list_audit_logs(
    entity_type: str | None = None,
    entity_id: str | None = None,
    db: DBSession = Depends(get_db),
):
    q = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.filter(AuditLog.entity_id == entity_id)
    return q.all()


@router.post("", response_model=SessionOut, status_code=201)
def create_session(body: SessionCreate, db: DBSession = Depends(get_db)):
    pv = db.get(PlanVersion, body.plan_version_id)
    if not pv:
        raise HTTPException(400, "PlanVersion not found")

    session = Session(plan_version_id=body.plan_version_id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/run", response_model=SessionOut)
async def run_session_endpoint(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    session = db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.status not in ("pending",):
        raise HTTPException(400, f"Session is already {session.status}")

    # Create SSE queue before launching background task
    get_or_create_queue(session_id)

    # Launch agent loop as a FastAPI background task (runs after response is sent)
    background_tasks.add_task(run_session, session_id, SessionLocal)

    db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionDetailOut)
def get_session(session_id: str, db: DBSession = Depends(get_db)):
    session = db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@router.post("/{session_id}/abort", response_model=SessionOut)
def abort_session(session_id: str, db: DBSession = Depends(get_db)):
    session = db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.status not in ("running", "pending"):
        raise HTTPException(400, "Session is not running")
    session.status = "aborted"
    session.termination_reason = "aborted"
    db.commit()
    db.refresh(session)
    return session


@router.get("/{session_id}/stream")
async def stream_session(session_id: str, db: DBSession = Depends(get_db)):
    """SSE endpoint — streams live events while session is running."""
    session = db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    queue = get_or_create_queue(session_id)

    async def event_generator() -> AsyncGenerator[str, None]:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=30.0)
            except asyncio.TimeoutError:
                yield "event: ping\ndata: {}\n\n"
                continue

            if item is None:
                yield "event: done\ndata: {}\n\n"
                break

            yield f"event: message\ndata: {json.dumps(item)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{session_id}/events", response_model=list[EventOut])
def get_events(session_id: str, db: DBSession = Depends(get_db)):
    session = db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session.events


@router.get("/{session_id}/metrics")
def get_session_metrics(session_id: str, db: DBSession = Depends(get_db)):
    """Per-session derived metrics."""
    session = db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    events = session.events
    tool_calls: dict[str, int] = {}
    tool_sequence: list[str] = []
    hallucinated_count = 0
    error_count = 0
    call_made = False

    for ev in events:
        payload = json.loads(ev.payload) if isinstance(ev.payload, str) else ev.payload
        if ev.type == "tool_call":
            name = payload.get("name", "unknown")
            tool_calls[name] = tool_calls.get(name, 0) + 1
            tool_sequence.append(name)
            call_made = True
        elif ev.type == "hallucinated_tool_call":
            hallucinated_count += 1
        elif ev.type == "tool_error":
            error_count += 1

    totals = json.loads(session.totals) if isinstance(session.totals, str) else session.totals

    return {
        "session_id": session_id,
        "status": session.status,
        "termination_reason": session.termination_reason,
        "any_tool_called": call_made,
        "tool_calls": tool_calls,
        "tool_sequence": tool_sequence,
        "hallucinated_tool_calls": hallucinated_count,
        "tool_errors": error_count,
        **totals,
    }


@router.delete("/{session_id}", status_code=200)
def delete_session(session_id: str, body: SessionDeleteBody, db: DBSession = Depends(get_db)):
    session = db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    if session.status == "running":
        raise HTTPException(400, "Cannot delete a running session")

    # Build snapshot: serialize session + events
    events_data = []
    for ev in session.events:
        events_data.append({
            "id": ev.id,
            "sequence_no": ev.sequence_no,
            "timestamp": ev.timestamp.isoformat() if ev.timestamp else None,
            "type": ev.type,
            "payload": json.loads(ev.payload) if isinstance(ev.payload, str) else ev.payload,
            "latency_ms": ev.latency_ms,
            "token_usage": json.loads(ev.token_usage) if isinstance(ev.token_usage, str) else ev.token_usage,
            "tool_call_id": ev.tool_call_id,
        })

    snapshot = {
        "session": {
            "id": session.id,
            "plan_version_id": session.plan_version_id,
            "batch_id": session.batch_id,
            "batch_index": session.batch_index,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            "status": session.status,
            "termination_reason": session.termination_reason,
            "tool_order_used": json.loads(session.tool_order_used) if isinstance(session.tool_order_used, str) else session.tool_order_used,
            "totals": json.loads(session.totals) if isinstance(session.totals, str) else session.totals,
        },
        "events": events_data,
    }

    log = AuditLog(
        entity_type="session",
        entity_id=session_id,
        action="delete",
        reason=body.reason,
        snapshot=json.dumps(snapshot, default=str),
    )
    db.add(log)
    db.delete(session)
    db.commit()
    db.refresh(log)
    return log
