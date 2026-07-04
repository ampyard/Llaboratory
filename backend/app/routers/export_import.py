from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import (
    Event,
    ModelConfig,
    Plan,
    PlanVersion,
    RunBatch,
    Session as SessionModel,
    Tool,
    ToolVersion,
    plan_version_tools,
)
from app.seed import SEED_TOOLS, seed_tools

router = APIRouter()


# ── Export ────────────────────────────────────────────────────────────────────


class ExportSelection(BaseModel):
    tool_ids: list[str] | None = None
    model_config_ids: list[str] | None = None
    plan_ids: list[str] | None = None


@router.post("/export")
def export_data(body: ExportSelection, db: Session = Depends(get_db)):
    tools_q = db.query(Tool).options(joinedload(Tool.versions))
    if body.tool_ids is not None:
        tools_q = tools_q.filter(Tool.id.in_(body.tool_ids))
    tools = tools_q.all()

    mc_q = db.query(ModelConfig)
    if body.model_config_ids is not None:
        mc_q = mc_q.filter(ModelConfig.id.in_(body.model_config_ids))
    model_configs = mc_q.all()

    plans_q = db.query(Plan).options(
        joinedload(Plan.versions).joinedload(PlanVersion.tool_versions),
        joinedload(Plan.versions).joinedload(PlanVersion.sessions).joinedload(SessionModel.events),
    )
    if body.plan_ids is not None:
        plans_q = plans_q.filter(Plan.id.in_(body.plan_ids))
    plans = plans_q.all()

    # Collect all plan_version_ids for the selected plans
    pv_ids = [pv.id for plan in plans for pv in plan.versions]

    # Fetch related run_batches
    run_batches = db.query(RunBatch).filter(RunBatch.plan_version_id.in_(pv_ids)).all() if pv_ids else []

    export: dict = {
        "version": 2,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "tools": [],
        "model_configs": [],
        "plans": [],
        "run_batches": [],
        "sessions": [],
        "events": [],
    }

    for tool in tools:
        export["tools"].append({
            "name": tool.name,
            "description": tool.description,
            "tags": json.loads(tool.tags) if isinstance(tool.tags, str) else tool.tags,
            "versions": [
                {
                    "version_number": v.version_number,
                    "display_name": v.display_name,
                    "model_facing_description": v.model_facing_description,
                    "parameter_schema": _parse_json(v.parameter_schema),
                    "response_mode": v.response_mode,
                    "static_response": _parse_json(v.static_response),
                    "dynamic_code": v.dynamic_code,
                    "dynamic_approved": v.dynamic_approved,
                    "manual_config": v.manual_config,
                }
                for v in tool.versions
            ],
        })

    for mc in model_configs:
        export["model_configs"].append({
            "name": mc.name,
            "provider_kind": mc.provider_kind,
            "base_url": mc.base_url,
            "model_snapshot": mc.model_snapshot,
            "params": _parse_json(mc.params),
            "api_key_env": mc.api_key_env,
            "input_cost_per_1k": mc.input_cost_per_1k,
            "output_cost_per_1k": mc.output_cost_per_1k,
        })

    for plan in plans:
        plan_data: dict = {
            "name": plan.name,
            "description": plan.description,
            "versions": [],
        }
        for pv in plan.versions:
            mcs = _parse_json(pv.model_config_snapshot)
            version_data: dict = {
                "original_id": pv.id,
                "version_number": pv.version_number,
                "system_prompt": pv.system_prompt,
                "user_prompt": pv.user_prompt,
                "run_settings": _parse_json(pv.run_settings),
                "model_config_name": mcs.get("name", ""),
                "tool_versions": [],
            }
            for tv in pv.tool_versions:
                tool_name = tv.tool.name if tv.tool else ""
                row = (
                    db.query(plan_version_tools.c.position)
                    .filter(
                        plan_version_tools.c.plan_version_id == pv.id,
                        plan_version_tools.c.tool_version_id == tv.id,
                    )
                    .first()
                )
                pos = row[0] if row else 0
                version_data["tool_versions"].append({
                    "tool_name": tool_name,
                    "display_name": tv.display_name,
                    "position": pos,
                })
            plan_data["versions"].append(version_data)
        export["plans"].append(plan_data)

    for rb in run_batches:
        export["run_batches"].append({
            "original_id": rb.id,
            "name": rb.name,
            "requested_repetitions": rb.requested_repetitions,
            "status": rb.status,
            "plan_version_id": rb.plan_version_id,
            "created_at": rb.created_at.isoformat() if rb.created_at else None,
            "started_at": rb.started_at.isoformat() if rb.started_at else None,
            "ended_at": rb.ended_at.isoformat() if rb.ended_at else None,
        })

    for plan in plans:
        for pv in plan.versions:
            for session in pv.sessions:
                export["sessions"].append({
                    "original_id": session.id,
                    "plan_version_id": pv.id,
                    "batch_id": session.batch_id,
                    "batch_index": session.batch_index,
                    "started_at": session.started_at.isoformat() if session.started_at else None,
                    "ended_at": session.ended_at.isoformat() if session.ended_at else None,
                    "status": session.status,
                    "termination_reason": session.termination_reason,
                    "tool_order_used": json.loads(session.tool_order_used) if isinstance(session.tool_order_used, str) else session.tool_order_used,
                    "totals": _parse_json(session.totals),
                })
                for event in session.events:
                    export["events"].append({
                        "session_id": session.id,
                        "sequence_no": event.sequence_no,
                        "timestamp": event.timestamp.isoformat() if event.timestamp else None,
                        "type": event.type,
                        "payload": _parse_json(event.payload),
                        "latency_ms": event.latency_ms,
                        "token_usage": _parse_json(event.token_usage) if event.token_usage else None,
                        "tool_call_id": event.tool_call_id,
                    })

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("export.json", json.dumps(export, indent=2, default=str))
    buf.seek(0)

    filename = (
        f"llaboratory-export-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.zip"
    )
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Import Check ──────────────────────────────────────────────────────────────


@router.post("/import/check")
def import_check(file: UploadFile = File(...), db: Session = Depends(get_db)):
    data = _parse_export_zip(file)
    conflicts = _check_name_conflicts(db, data)
    return {"has_conflicts": len(conflicts) > 0, "conflicts": conflicts}


# ── Import ────────────────────────────────────────────────────────────────────


@router.post("/import")
def import_data(
    file: UploadFile = File(...),
    rename_map: str = Form("{}"),
    db: Session = Depends(get_db),
):
    renames = json.loads(rename_map)

    data = _parse_export_zip(file)

    _apply_renames(data, renames)

    conflicts = _check_name_conflicts(db, data)
    if conflicts:
        return {"success": False, "error": "Naming conflicts still exist", "conflicts": conflicts}

    summary = _perform_import(db, data)
    return {"success": True, **summary}


# ── Factory Reset ─────────────────────────────────────────────────────────────


@router.post("/factory-reset")
def factory_reset(db: Session = Depends(get_db)):
    db.query(Event).delete()
    db.query(SessionModel).delete()
    db.query(RunBatch).delete()
    db.query(PlanVersion).delete()
    db.query(Plan).delete()
    db.query(ModelConfig).delete()
    db.query(Tool).delete()
    db.commit()
    return {"success": True}


# ── Seed (on-demand built-in tools) ──────────────────────────────────────────


class SeedToolPreview(BaseModel):
    name: str
    description: str
    tags: list[str]
    parameter_schema: dict


@router.get("/seed/preview")
def seed_preview():
    """List the built-in sample tools without loading them into the database."""
    return [
        SeedToolPreview(
            name=t["name"],
            description=t["description"],
            tags=t["tags"],
            parameter_schema=t["version"]["parameter_schema"],
        )
        for t in SEED_TOOLS
    ]


@router.post("/seed")
def seed():
    """Load the built-in sample tools. Safe to call multiple times (idempotent)."""
    from app.database import SessionLocal
    session = SessionLocal()
    try:
        seed_tools(session)
    finally:
        session.close()
    return {"success": True}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _parse_json(v: str | dict | list | None) -> dict | list:
    if v is None:
        return {}
    if isinstance(v, str):
        try:
            return json.loads(v)
        except (json.JSONDecodeError, TypeError):
            return {}
    return v


def _parse_export_zip(file: UploadFile) -> dict:
    contents = file.file.read()
    try:
        with zipfile.ZipFile(io.BytesIO(contents), "r") as zf:
            names = zf.namelist()
            json_candidates = [n for n in names if n.endswith(".json")]
            if not json_candidates:
                raise ValueError("No JSON file found in the ZIP archive")
            info = zf.getinfo(json_candidates[0])
            raw = zf.read(info)
            data = json.loads(raw)
    except zipfile.BadZipFile:
        raise ValueError("Uploaded file is not a valid ZIP archive")
    except json.JSONDecodeError:
        raise ValueError("Export JSON is malformed")
    return data


def _check_name_conflicts(db: Session, data: dict) -> list[dict]:
    conflicts: list[dict] = []

    incoming_tool_names = {t["name"] for t in data.get("tools", [])}
    existing_tool_names = {
        r[0] for r in db.query(Tool.name).filter(Tool.name.in_(incoming_tool_names)).all()
    }
    for name in sorted(incoming_tool_names & existing_tool_names):
        conflicts.append({"type": "tool", "name": name, "message": f'A tool named "{name}" already exists'})

    incoming_mc_names = {m["name"] for m in data.get("model_configs", [])}
    existing_mc_names = {
        r[0]
        for r in db.query(ModelConfig.name)
        .filter(ModelConfig.name.in_(incoming_mc_names))
        .all()
    }
    for name in sorted(incoming_mc_names & existing_mc_names):
        conflicts.append({"type": "model_config", "name": name, "message": f'A model config named "{name}" already exists'})

    incoming_plan_names = {p["name"] for p in data.get("plans", [])}
    existing_plan_names = {
        r[0]
        for r in db.query(Plan.name).filter(Plan.name.in_(incoming_plan_names)).all()
    }
    for name in sorted(incoming_plan_names & existing_plan_names):
        conflicts.append({"type": "plan", "name": name, "message": f'A plan named "{name}" already exists'})

    return conflicts


def _apply_renames(data: dict, renames: dict):
    tool_map = renames.get("tools", {})
    for t in data.get("tools", []):
        if t["name"] in tool_map:
            t["name"] = tool_map[t["name"]]

    mc_map = renames.get("model_configs", {})
    for m in data.get("model_configs", []):
        if m["name"] in mc_map:
            m["name"] = mc_map[m["name"]]

    plan_map = renames.get("plans", {})
    for p in data.get("plans", []):
        if p["name"] in plan_map:
            p["name"] = plan_map[p["name"]]

    # Also update references inside plan versions to match renames
    for p in data.get("plans", []):
        for pv in p.get("versions", []):
            if pv.get("model_config_name") in mc_map:
                pv["model_config_name"] = mc_map[pv["model_config_name"]]
            for tv_ref in pv.get("tool_versions", []):
                if tv_ref.get("tool_name") in tool_map:
                    tv_ref["tool_name"] = tool_map[tv_ref["tool_name"]]


def _perform_import(db: Session, data: dict) -> dict:
    now = datetime.now(timezone.utc)
    tool_ref_cache: dict[tuple[str, str], str] = {}

    # ── 1. Import tools ──
    imported_tools = 0
    imported_versions = 0
    for t in data.get("tools", []):
        tool_id = str(uuid.uuid4())
        tool = Tool(
            id=tool_id,
            name=t["name"],
            description=t.get("description", ""),
            tags=json.dumps(t.get("tags", [])),
            built_in=0,
            created_at=now,
        )
        db.add(tool)

        for v in t.get("versions", []):
            tv_id = str(uuid.uuid4())
            tv = ToolVersion(
                id=tv_id,
                tool_id=tool_id,
                version_number=v["version_number"],
                created_at=now,
                display_name=v["display_name"],
                model_facing_description=v.get("model_facing_description", ""),
                parameter_schema=json.dumps(v.get("parameter_schema", {})),
                response_mode=v.get("response_mode", "static"),
                static_response=json.dumps(v.get("static_response", {})),
                dynamic_code=v.get("dynamic_code"),
                dynamic_approved=v.get("dynamic_approved", 0),
                manual_config=v.get("manual_config", '{"replay_default":true}'),
            )
            db.add(tv)
            tool_ref_cache[(t["name"], v["display_name"])] = tv_id
            imported_versions += 1
        imported_tools += 1

    db.flush()

    # ── 2. Import model configs ──
    mc_name_to_new_id: dict[str, str] = {}
    imported_mcs = 0
    for m in data.get("model_configs", []):
        mc_id = str(uuid.uuid4())
        mc = ModelConfig(
            id=mc_id,
            name=m["name"],
            provider_kind=m.get("provider_kind", "openai_compatible"),
            base_url=m["base_url"],
            model_snapshot=m["model_snapshot"],
            params=json.dumps(m.get("params", {})),
            api_key_env=m.get("api_key_env", ""),
            input_cost_per_1k=m.get("input_cost_per_1k", 0.0),
            output_cost_per_1k=m.get("output_cost_per_1k", 0.0),
            created_at=now,
        )
        db.add(mc)
        mc_name_to_new_id[m["name"]] = mc_id
        imported_mcs += 1

    # ── 3. Import plans → plan_versions → version_tools ──
    old_pv_id_to_new: dict[str, str] = {}
    imported_plans = 0
    imported_plan_versions = 0
    for p in data.get("plans", []):
        plan_id = str(uuid.uuid4())
        plan = Plan(
            id=plan_id,
            name=p["name"],
            description=p.get("description", ""),
            created_at=now,
        )
        db.add(plan)

        for pv_data in p.get("versions", []):
            mc_name = pv_data.get("model_config_name", "")
            mc_snapshot: dict = {}
            if mc_name and mc_name in mc_name_to_new_id:
                mc_obj = db.query(ModelConfig).filter(
                    ModelConfig.id == mc_name_to_new_id[mc_name]
                ).first()
                if mc_obj:
                    mc_snapshot = {
                        "id": mc_obj.id,
                        "name": mc_obj.name,
                        "provider_kind": mc_obj.provider_kind,
                        "base_url": mc_obj.base_url,
                        "model_snapshot": mc_obj.model_snapshot,
                        "params": _parse_json(mc_obj.params),
                        "api_key_env": mc_obj.api_key_env,
                        "input_cost_per_1k": mc_obj.input_cost_per_1k,
                        "output_cost_per_1k": mc_obj.output_cost_per_1k,
                        "created_at": mc_obj.created_at.isoformat() if mc_obj.created_at else None,
                    }

            pv_id = str(uuid.uuid4())
            pv = PlanVersion(
                id=pv_id,
                plan_id=plan_id,
                version_number=pv_data["version_number"],
                created_at=now,
                model_config_snapshot=json.dumps(mc_snapshot),
                system_prompt=pv_data.get("system_prompt", ""),
                user_prompt=pv_data.get("user_prompt", ""),
                run_settings=json.dumps(pv_data.get("run_settings", {})),
            )
            db.add(pv)
            db.flush()

            for tv_ref in pv_data.get("tool_versions", []):
                tv_id = tool_ref_cache.get(
                    (tv_ref["tool_name"], tv_ref["display_name"])
                )
                if tv_id:
                    db.execute(
                        plan_version_tools.insert().values(
                            plan_version_id=pv_id,
                            tool_version_id=tv_id,
                            position=tv_ref.get("position", 0),
                        )
                    )

            old_pv_id_to_new[pv_data["original_id"]] = pv_id
            imported_plan_versions += 1
        imported_plans += 1

    # ── 4. Import run_batches ──
    old_batch_id_to_new: dict[str, str] = {}
    imported_batches = 0
    for rb_data in data.get("run_batches", []):
        new_pv_id = old_pv_id_to_new.get(rb_data["plan_version_id"])
        if not new_pv_id:
            continue
        new_id = str(uuid.uuid4())
        rb = RunBatch(
            id=new_id,
            plan_version_id=new_pv_id,
            name=rb_data.get("name", ""),
            requested_repetitions=rb_data.get("requested_repetitions", 1),
            status=rb_data.get("status", "completed"),
            created_at=_parse_dt(rb_data.get("created_at"), now),
            started_at=_parse_dt(rb_data.get("started_at"), None),
            ended_at=_parse_dt(rb_data.get("ended_at"), None),
        )
        db.add(rb)
        old_batch_id_to_new[rb_data["original_id"]] = new_id
        imported_batches += 1

    # ── 5. Import sessions ──
    old_session_id_to_new: dict[str, str] = {}
    imported_sessions = 0
    for s_data in data.get("sessions", []):
        new_pv_id = old_pv_id_to_new.get(s_data["plan_version_id"])
        if not new_pv_id:
            continue
        new_id = str(uuid.uuid4())
        old_batch_id = s_data.get("batch_id")
        new_batch_id = old_batch_id_to_new.get(old_batch_id) if old_batch_id else None
        session = SessionModel(
            id=new_id,
            plan_version_id=new_pv_id,
            batch_id=new_batch_id,
            batch_index=s_data.get("batch_index", 0),
            started_at=_parse_dt(s_data.get("started_at"), None),
            ended_at=_parse_dt(s_data.get("ended_at"), None),
            status=s_data.get("status", "pending"),
            termination_reason=s_data.get("termination_reason"),
            tool_order_used=json.dumps(s_data.get("tool_order_used", [])),
            totals=json.dumps(s_data.get("totals", {})),
        )
        db.add(session)
        old_session_id_to_new[s_data["original_id"]] = new_id
        imported_sessions += 1

    # ── 6. Import events ──
    imported_events = 0
    for e_data in data.get("events", []):
        new_session_id = old_session_id_to_new.get(e_data["session_id"])
        if not new_session_id:
            continue
        event = Event(
            id=str(uuid.uuid4()),
            session_id=new_session_id,
            sequence_no=e_data["sequence_no"],
            timestamp=_parse_dt(e_data.get("timestamp"), now),
            type=e_data["type"],
            payload=json.dumps(e_data.get("payload", {})),
            latency_ms=e_data.get("latency_ms"),
            token_usage=json.dumps(e_data["token_usage"]) if e_data.get("token_usage") else None,
            tool_call_id=e_data.get("tool_call_id"),
        )
        db.add(event)
        imported_events += 1

    db.commit()

    return {
        "imported_tools": imported_tools,
        "imported_tool_versions": imported_versions,
        "imported_model_configs": imported_mcs,
        "imported_plans": imported_plans,
        "imported_plan_versions": imported_plan_versions,
        "imported_run_batches": imported_batches,
        "imported_sessions": imported_sessions,
        "imported_events": imported_events,
    }


def _parse_dt(val: str | None, default):
    if not val:
        return default
    try:
        return datetime.fromisoformat(val)
    except (ValueError, TypeError):
        return default
