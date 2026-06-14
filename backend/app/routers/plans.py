from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json

from app.database import get_db
from app.models import Plan, PlanVersion, ModelConfig, ToolVersion
from app.schemas import PlanCreate, PlanOut, PlanVersionCreate, PlanVersionOut

router = APIRouter(prefix="/plans", tags=["plans"])


def _freeze_model_config(mc: ModelConfig) -> dict:
    return {
        "id": mc.id,
        "name": mc.name,
        "provider_kind": mc.provider_kind,
        "base_url": mc.base_url,
        "model_snapshot": mc.model_snapshot,
        "params": json.loads(mc.params) if isinstance(mc.params, str) else mc.params,
        "api_key_env": mc.api_key_env,
        "input_cost_per_1k": mc.input_cost_per_1k,
        "output_cost_per_1k": mc.output_cost_per_1k,
    }


def _build_plan_version(plan_id: str, body: PlanVersionCreate, version_number: int, db: Session) -> PlanVersion:
    mc = db.get(ModelConfig, body.model_config_id)
    if not mc:
        raise HTTPException(400, f"ModelConfig '{body.model_config_id}' not found")

    tool_versions = []
    for tv_id in body.tool_version_ids:
        tv = db.get(ToolVersion, tv_id)
        if not tv:
            raise HTTPException(400, f"ToolVersion '{tv_id}' not found")
        tool_versions.append(tv)

    pv = PlanVersion(
        plan_id=plan_id,
        version_number=version_number,
        model_config_snapshot=json.dumps(_freeze_model_config(mc)),
        system_prompt=body.system_prompt,
        user_prompt=body.user_prompt,
        run_settings=json.dumps(body.run_settings.model_dump()),
    )
    pv.tool_versions = tool_versions
    return pv


@router.get("", response_model=list[PlanOut])
def list_plans(db: Session = Depends(get_db)):
    return db.query(Plan).order_by(Plan.created_at.desc()).all()


@router.post("", response_model=PlanOut, status_code=201)
def create_plan(body: PlanCreate, db: Session = Depends(get_db)):
    plan = Plan(name=body.name, description=body.description)
    db.add(plan)
    db.flush()

    pv = _build_plan_version(plan.id, body.version, 1, db)
    db.add(pv)
    db.commit()
    db.refresh(plan)
    return plan


@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(plan_id: str, db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    return plan


@router.post("/{plan_id}/versions", response_model=PlanVersionOut, status_code=201)
def create_plan_version(plan_id: str, body: PlanVersionCreate, db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")

    next_version = max((pv.version_number for pv in plan.versions), default=0) + 1
    pv = _build_plan_version(plan_id, body, next_version, db)
    db.add(pv)
    db.commit()
    db.refresh(pv)
    return pv


@router.post("/{plan_id}/clone", response_model=PlanOut, status_code=201)
def clone_plan(plan_id: str, db: Session = Depends(get_db)):
    original = db.get(Plan, plan_id)
    if not original:
        raise HTTPException(404, "Plan not found")

    source_pv = (original.versions or [None])[-1]
    if not source_pv:
        raise HTTPException(400, "Original plan has no versions to clone.")

    clone = Plan(
        name=f"{original.name}_clone",
        description=original.description,
    )
    db.add(clone)
    db.flush()

    pv = PlanVersion(
        plan_id=clone.id,
        version_number=1,
        model_config_snapshot=source_pv.model_config_snapshot,
        system_prompt=source_pv.system_prompt,
        user_prompt=source_pv.user_prompt,
        run_settings=source_pv.run_settings,
    )
    pv.tool_versions = list(source_pv.tool_versions)
    db.add(pv)
    db.commit()
    db.refresh(clone)
    return clone


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: str, db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    db.delete(plan)
    db.commit()
