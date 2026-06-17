from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json
import os

from app.database import get_db
from app.models import ModelConfig
from app.schemas import ModelConfigCreate, ModelConfigOut, ModelConfigUpdate
from app.services.provider import assemble_response, ProviderError

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
    db.delete(mc)
    db.commit()


@router.post("/{config_id}/test-model")
async def test_model_config(config_id: str, db: Session = Depends(get_db)):
    """Test a model config by making a simple completion call."""
    mc = db.get(ModelConfig, config_id)
    if not mc:
        raise HTTPException(404, "ModelConfig not found")

    # Check if API key is set
    if mc.api_key_env:
        api_key = os.environ.get(mc.api_key_env)
        if not api_key:
            raise HTTPException(400, f"API key environment variable '{mc.api_key_env}' is not set")

    # Parse params
    params = json.loads(mc.params) if isinstance(mc.params, str) else mc.params or {}

    # Make a simple test completion
    test_messages = [
        {"role": "user", "content": "Say 'test successful' if you can read this message."}
    ]

    try:
        response = await assemble_response(
            base_url=mc.base_url,
            api_key_env=mc.api_key_env,
            model=mc.model_snapshot,
            messages=test_messages,
            tools=[],
            params=params,
        )

        # Extract text content from response
        text_content = ""
        for part in response.get("content_parts", []):
            if part.get("type") == "text":
                text_content += part.get("content", "")

        return {
            "success": True,
            "message": "Model configuration test successful",
            "response": text_content,
            "token_usage": response.get("token_usage", {}),
        }
    except ProviderError as e:
        raise HTTPException(400, f"Provider error: {str(e)}")
    except Exception as e:
        raise HTTPException(500, f"Test failed: {str(e)}")
