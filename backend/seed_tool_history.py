"""
Seed script: injects fake tool call history into harness.db so you can
test the Call History feature on the Tool Stats page without an API key.

Usage:  uv run python seed_tool_history.py
"""
import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

DB_PATH = "harness.db"

# We'll use two existing built-in tools from the live DB.
TOOLS = [
    {
        "tool_id": "78b5b858-414f-4766-9e7b-aa757ecf58d2",
        "display_name": "summon_cat",
    },
    {
        "tool_id": "a6b04fe7-8da2-4045-a546-616c6b0703f1",
        "display_name": "snake_oil",
    },
]

# Grab an existing plan_version_id from the DB to attach sessions to.
con = sqlite3.connect(DB_PATH)
con.row_factory = sqlite3.Row
cur = con.cursor()

cur.execute("SELECT id FROM plan_versions LIMIT 1")
pv_row = cur.fetchone()
if pv_row is None:
    print("❌  No plan versions found in harness.db.")
    print("   Please create at least one Plan first via the UI, then re-run this script.")
    con.close()
    exit(1)

plan_version_id = pv_row["id"]
print(f"✅  Using plan_version_id: {plan_version_id}")

now = datetime.now(timezone.utc)

def _uuid():
    return str(uuid.uuid4())

def _iso(dt):
    return dt.isoformat()

def insert_session(cur, plan_version_id, started_at, status="completed"):
    sid = _uuid()
    cur.execute(
        """INSERT INTO sessions
           (id, plan_version_id, batch_id, batch_index, started_at, ended_at,
            status, termination_reason, tool_order_used, totals)
           VALUES (?,?,NULL,0,?,?,?,'completed_with_tool_call','[]','{}')""",
        (sid, plan_version_id, _iso(started_at), _iso(started_at + timedelta(seconds=5)), status),
    )
    return sid

def insert_event(cur, session_id, seq, ev_type, payload, latency_ms=None, tool_call_id=None, ts=None):
    ts = ts or now
    cur.execute(
        """INSERT INTO events
           (id, session_id, sequence_no, timestamp, type, payload, latency_ms, token_usage, tool_call_id)
           VALUES (?,?,?,?,?,?,?,NULL,?)""",
        (_uuid(), session_id, seq, _iso(ts), ev_type, json.dumps(payload), latency_ms, tool_call_id),
    )


# ── Session 1: summon_cat – 2 successful calls, different incantations ────────
s1_start = now - timedelta(hours=2)
s1 = insert_session(cur, plan_version_id, s1_start)

tc1a = _uuid()
insert_event(cur, s1, 1, "tool_call",
             {"name": "summon_cat", "parsed_args": {"incantation": "here kitty kitty", "tribute": "tuna"},
              "raw_args": '{"incantation":"here kitty kitty","tribute":"tuna"}'},
             latency_ms=312, tool_call_id=tc1a, ts=s1_start + timedelta(seconds=1))
insert_event(cur, s1, 2, "tool_result",
             {"name": "summon_cat", "result": {"cat_arrived": True, "cat_name": "Lord Whiskers the Unimpressed",
              "cat_mood": "grudgingly curious", "did_accept_tribute": True}},
             tool_call_id=tc1a, ts=s1_start + timedelta(seconds=2))

tc1b = _uuid()
insert_event(cur, s1, 3, "tool_call",
             {"name": "summon_cat", "parsed_args": {"incantation": "I offer you my debugging sorrows", "tribute": "catnip"},
              "raw_args": '{"incantation":"I offer you my debugging sorrows","tribute":"catnip"}'},
             latency_ms=487, tool_call_id=tc1b, ts=s1_start + timedelta(seconds=3))
insert_event(cur, s1, 4, "tool_result",
             {"name": "summon_cat", "result": {"cat_arrived": False, "cat_mood": "entirely unimpressed",
              "parting_remark": "Catnip? Really? You disappoint me."}},
             tool_call_id=tc1b, ts=s1_start + timedelta(seconds=4))

print(f"✅  Session 1 (summon_cat × 2 success): {s1}")

# ── Session 2: summon_cat – 1 error call ──────────────────────────────────────
s2_start = now - timedelta(hours=1)
s2 = insert_session(cur, plan_version_id, s2_start)

tc2a = _uuid()
insert_event(cur, s2, 1, "tool_call",
             {"name": "summon_cat", "parsed_args": {"incantation": "go cat go", "tribute": "belly_rub"},
              "raw_args": '{"incantation":"go cat go","tribute":"belly_rub"}'},
             latency_ms=152, tool_call_id=tc2a, ts=s2_start + timedelta(seconds=1))
insert_event(cur, s2, 2, "tool_error",
             {"name": "summon_cat", "error": "Cat portal timeout: the feline realm is temporarily unavailable"},
             tool_call_id=tc2a, ts=s2_start + timedelta(seconds=2))

print(f"✅  Session 2 (summon_cat error): {s2}")

# ── Session 3: snake_oil – 1 success call ─────────────────────────────────────
s3_start = now - timedelta(minutes=15)
s3 = insert_session(cur, plan_version_id, s3_start)

tc3a = _uuid()
insert_event(cur, s3, 1, "tool_call",
             {"name": "snake_oil", "parsed_args": {"ailment": "chronic overthinking and deadline dread"},
              "raw_args": '{"ailment":"chronic overthinking and deadline dread"}'},
             latency_ms=98, tool_call_id=tc3a, ts=s3_start + timedelta(seconds=1))
insert_event(cur, s3, 2, "tool_result",
             {"name": "snake_oil", "result": {"prescription": "Two tablespoons of Dr. Ambrose's Miracle Elixir",
              "cure_guaranteed": True, "scientifically_verified": False,
              "price": "Your immortal soul (or $19.99, whichever is more convenient)"}},
             tool_call_id=tc3a, ts=s3_start + timedelta(seconds=2))

print(f"✅  Session 3 (snake_oil × 1 success): {s3}")

# ── Session 4: most recent, summon_cat with hallucinated call ─────────────────
s4_start = now - timedelta(minutes=3)
s4 = insert_session(cur, plan_version_id, s4_start)

tc4a = _uuid()
insert_event(cur, s4, 1, "hallucinated_tool_call",
             {"name": "summon_cat", "args": {"incantation": "please just work", "tribute": "pizza"}},
             tool_call_id=tc4a, ts=s4_start + timedelta(seconds=1))

print(f"✅  Session 4 (summon_cat hallucinated): {s4}")

con.commit()
con.close()

print()
print("🎉  Done! Seed data inserted into harness.db.")
print()
print("👉  Now go to: http://localhost:5173/tools")
print("    Click the 📊 Stats icon next to 'summon_cat' to see the Call History.")
print("    The 'snake_oil' tool also has one call — check its Stats too!")
