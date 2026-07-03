from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
import json

from app.database import get_db
from app.models import ModelConfig, PlanVersion
from app.schemas import ModelConfigCreate, ModelConfigOut, ModelConfigUpdate

router = APIRouter(prefix="/model-configs", tags=["model-configs"])


@router.get("", response_model=list[ModelConfigOut])
def list_model_configs(db: Session = Depends(get_db)):
    return db.query(ModelConfig).order_by(ModelConfig.created_at.desc()).all()


@router.post("", response_model=ModelConfigOut, status_code=201)
def create_model_config(body: ModelConfigCreate, db: Session = Depends(get_db)):
    mc = ModelConfig(
        name=body.name,
        base_url=body.base_url,
        model_snapshot=body.model_snapshot,
        api_key_env=body.api_key_env,
        params=json.dumps(body.params),
        input_cost_per_1k=body.input_cost_per_1k,
        output_cost_per_1k=body.output_cost_per_1k,
    )
    db.add(mc)
    db.commit()
    db.refresh(mc)
    return mc


@router.get("/{config_id}", response_model=ModelConfigOut)
def get_model_config(config_id: str, db: Session = Depends(get_db)):
    mc = db.get(ModelConfig, config_id)
    if not mc:
        raise HTTPException(404, "ModelConfig not found")
    return mc


@router.patch("/{config_id}", response_model=ModelConfigOut)
def update_model_config(config_id: str, body: ModelConfigUpdate, db: Session = Depends(get_db)):
    mc = db.get(ModelConfig, config_id)
    if not mc:
        raise HTTPException(404, "ModelConfig not found")
    for field, value in body.model_dump(exclude_none=True).items():
        if field == "params":
            setattr(mc, field, json.dumps(value))
        else:
            setattr(mc, field, value)
    db.commit()
    db.refresh(mc)
    return mc


@router.delete("/{config_id}", status_code=204)
def delete_model_config(config_id: str, db: Session = Depends(get_db)):
    mc = db.get(ModelConfig, config_id)
    if not mc:
        raise HTTPException(404, "ModelConfig not found")

    referenced = db.query(PlanVersion).filter(
        text("json_extract(model_config_snapshot, '$.id') = :id").bindparams(id=config_id)
    ).first()
    if referenced:
        raise HTTPException(
            409,
            "Cannot delete this model config because it is used by one or more plan versions."
        )

    db.delete(mc)
    db.commit()
