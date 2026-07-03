"""Sequential batch runner: executes N sessions belonging to one RunBatch, in order."""
from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy.orm import Session as DBSession

from app.models import RunBatch, Session
from app.services.agent_loop import run_session


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def run_batch(batch_id: str, db_factory) -> None:
    """
    Runs each session in a batch sequentially, one at a time.
    db_factory: callable returning a new DB session (needed since we're in a background task).
    """
    db: DBSession = db_factory()
    try:
        batch: RunBatch | None = db.get(RunBatch, batch_id)
        if batch is None:
            return

        batch.status = "running"
        batch.started_at = _utcnow()
        db.commit()

        sessions = (
            db.query(Session)
            .filter(Session.batch_id == batch_id)
            .order_by(Session.batch_index)
            .all()
        )
        session_ids = [s.id for s in sessions]

        errored_any = False
        try:
            for session_id in session_ids:
                db.refresh(batch)
                if batch.status == "aborted":
                    remaining = (
                        db.query(Session)
                        .filter(Session.batch_id == batch_id, Session.status == "pending")
                        .all()
                    )
                    for s in remaining:
                        s.status = "aborted"
                        s.termination_reason = "batch_aborted"
                    db.commit()
                    break

                try:
                    await run_session(session_id, db_factory)
                except Exception:
                    errored_any = True
                    continue

                db.refresh(batch)
                s = db.get(Session, session_id)
                if s:
                    db.refresh(s)
                    if s.status == "errored":
                        errored_any = True
        except Exception:
            # Guarantees the batch never gets stuck at "running"/"pending" even if
            # something outside the per-session try (e.g. a DB write above) blows up.
            errored_any = True

        db.rollback()  # discard any half-applied writes from a failed iteration before the final update
        db.refresh(batch)
        if batch.status != "aborted":
            batch.status = "errored" if errored_any else "completed"
        batch.ended_at = _utcnow()
        db.commit()
    finally:
        db.close()
