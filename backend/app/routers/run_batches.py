from __future__ import annotations
import json
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession

from app.database import get_db, SessionLocal
from app.models import RunBatch, Session, PlanVersion
from app.schemas import RunBatchCreate, RunBatchOut, RunBatchProgressOut
from app.services.agent_loop import get_or_create_queue
from app.services.batch_runner import run_batch

router = APIRouter(prefix="/run-batches", tags=["run-batches"])


@router.get("", response_model=list[RunBatchOut])
def list_batches(plan_version_id: str | None = None, db: DBSession = Depends(get_db)):
    q = db.query(RunBatch)
    if plan_version_id:
        q = q.filter(RunBatch.plan_version_id == plan_version_id)
    return q.order_by(RunBatch.created_at.desc()).all()


@router.post("", response_model=RunBatchOut, status_code=201)
def create_and_run_batch(
    body: RunBatchCreate,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    pv = db.get(PlanVersion, body.plan_version_id)
    if not pv:
        raise HTTPException(400, "PlanVersion not found")

    run_settings = json.loads(pv.run_settings)
    repetitions = body.repetitions or run_settings.get("repetitions", 1)
    repetitions = max(1, min(repetitions, 1000))
    name = body.name.strip() or datetime.now(timezone.utc).strftime("Batch %Y-%m-%d %H:%M")

    batch = RunBatch(plan_version_id=pv.id, name=name, requested_repetitions=repetitions, status="pending")
    db.add(batch)
    db.flush()

    sessions = []
    for i in range(repetitions):
        s = Session(plan_version_id=pv.id, batch_id=batch.id, batch_index=i)
        db.add(s)
        sessions.append(s)
    db.commit()
    db.refresh(batch)

    for s in sessions:
        get_or_create_queue(s.id)

    background_tasks.add_task(run_batch, batch.id, SessionLocal)
    return batch


@router.get("/{batch_id}", response_model=RunBatchProgressOut)
def get_batch(batch_id: str, db: DBSession = Depends(get_db)):
    batch = db.get(RunBatch, batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    sessions = sorted(batch.sessions, key=lambda s: s.batch_index)
    completed_count = sum(1 for s in sessions if s.status in ("completed", "errored", "aborted"))
    running_count = sum(1 for s in sessions if s.status == "running")
    pending_count = sum(1 for s in sessions if s.status == "pending")
    current = next((s for s in sessions if s.status == "running"), None) \
        or next((s for s in sessions if s.status == "pending"), None)

    # Self-healing: if every session has reached a terminal state but the batch
    # itself never got flipped out of pending/running (e.g. the background task
    # died mid-run), fix it up here instead of leaving it stuck forever.
    if batch.status in ("pending", "running") and sessions and running_count == 0 and pending_count == 0:
        batch.status = "errored" if any(s.status == "errored" for s in sessions) else "completed"
        batch.ended_at = batch.ended_at or datetime.now(timezone.utc)
        db.commit()

    return {
        "id": batch.id,
        "plan_version_id": batch.plan_version_id,
        "name": batch.name,
        "status": batch.status,
        "requested_repetitions": batch.requested_repetitions,
        "completed_count": completed_count,
        "running_count": running_count,
        "pending_count": pending_count,
        "current_session_id": current.id if current else None,
        "session_ids": [s.id for s in sessions],
        "sessions": sessions,
    }


@router.post("/{batch_id}/abort", response_model=RunBatchOut)
def abort_batch(batch_id: str, db: DBSession = Depends(get_db)):
    batch = db.get(RunBatch, batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")
    if batch.status not in ("pending", "running"):
        raise HTTPException(400, "Batch is not running")

    batch.status = "aborted"
    db.commit()

    current = (
        db.query(Session)
        .filter(Session.batch_id == batch_id, Session.status == "running")
        .first()
    )
    if current:
        current.status = "aborted"
        current.termination_reason = "aborted"
        db.commit()

    db.refresh(batch)
    return batch
