import json
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from openai import OpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth_utils import decode_token
from app.database import get_db
from app.models import User
from app.settings import settings

router = APIRouter(prefix="/llm", tags=["llm"])


class LLMInvokeBody(BaseModel):
    prompt: str
    response_json_schema: dict[str, Any] | None = None


@router.post("/invoke")
def invoke_llm(
    body: LLMInvokeBody,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.get(User, payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not set on the server. Add it to backend/.env to enable LLM features.",
        )

    client = OpenAI(api_key=settings.openai_api_key)
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
