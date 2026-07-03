import os

from sqlalchemy import create_engine, event, text
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./harness.db")

engine = create_engine(
    DATABASE_URL,
    # timeout: how long sqlite3 waits on a locked db before giving up — batch runs
    # open several concurrent connections (batch runner, agent loop, API requests),
    # so the default is too short under write contention.
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _set_wal_mode(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app import models  # noqa: F401 — import to register models
    Base.metadata.create_all(bind=engine)

    inspector = sa_inspect(engine)
    cols = [c["name"] for c in inspector.get_columns("tools")]
    if "built_in" not in cols:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE tools ADD COLUMN built_in INTEGER NOT NULL DEFAULT 0"))
            conn.commit()

    session_cols = [c["name"] for c in inspector.get_columns("sessions")]
    if "batch_id" not in session_cols:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE sessions ADD COLUMN batch_id VARCHAR"))
            conn.commit()
    if "batch_index" not in session_cols:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE sessions ADD COLUMN batch_index INTEGER NOT NULL DEFAULT 0"))
            conn.commit()

    batch_cols = [c["name"] for c in inspector.get_columns("run_batches")]
    if "name" not in batch_cols:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE run_batches ADD COLUMN name VARCHAR NOT NULL DEFAULT ''"))
            conn.commit()

    from app.seed import seed_tools
    session = SessionLocal()
    try:
        seed_tools(session)
    finally:
        session.close()
