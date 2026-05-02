import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from pydantic import BaseModel, Field

from app.deps import get_current_user
from app.models import User
from app.settings import settings

router = APIRouter(prefix="/llm", tags=["llm"])

_openai_client: OpenAI | None = OpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None


class LLMInvokeBody(BaseModel):
    prompt: str = Field(max_length=10000)
    response_json_schema: dict[str, Any] | None = None


@router.post("/invoke")
def invoke_llm(
    body: LLMInvokeBody,
    user: User = Depends(get_current_user),
):

    if _openai_client is None:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not set on the server. Add it to backend/.env to enable LLM features.",
        )

    client = _openai_client
    schema_hint = ""
    if body.response_json_schema:
        schema_hint = (
            "\nReturn a JSON object that matches this structure:\n"
            + json.dumps(body.response_json_schema)
        )

    sys_msg = (
        "You reply with a single JSON object only, no markdown fences, no explanation."
        + schema_hint
    )

    try:
        comp = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": body.prompt},
            ],
            response_format={"type": "json_object"},
        )
        raw = comp.choices[0].message.content or "{}"
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {e}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
