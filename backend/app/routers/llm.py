import json
import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.deps import get_current_user
from app.models import User
from app.settings import settings

router = APIRouter(prefix="/llm", tags=["llm"])
log = logging.getLogger(__name__)

ProviderName = Literal["openai", "anthropic", "gemini"]

# Checked left-to-right; first one with a key set wins.
_PRIORITY: list[ProviderName] = ["openai", "anthropic", "gemini"]


def _available() -> dict[ProviderName, bool]:
    return {
        "openai": bool(settings.openai_api_key),
        "anthropic": bool(settings.anthropic_api_key),
        "gemini": bool(settings.gemini_api_key),
    }


def _resolve_provider(preferred: ProviderName | None) -> ProviderName:
    av = _available()
    if preferred:
        if not av[preferred]:
            raise HTTPException(
                status_code=503,
                detail=f"{preferred.upper()}_API_KEY is not configured on this server.",
            )
        return preferred
    for p in _PRIORITY:
        if av[p]:
            return p
    raise HTTPException(
        status_code=503,
        detail=(
            "No LLM provider is configured. "
            "Set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY."
        ),
    )


def _system_message(schema: dict[str, Any] | None) -> str:
    hint = (
        "\nReturn a JSON object that matches this structure:\n" + json.dumps(schema)
        if schema
        else ""
    )
    return "You reply with a single JSON object only, no markdown fences, no explanation." + hint


def _invoke_openai(prompt: str, sys_msg: str) -> dict:
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    comp = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(comp.choices[0].message.content or "{}")


def _invoke_anthropic(prompt: str, sys_msg: str) -> dict:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=sys_msg,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text if msg.content else "{}"
    return json.loads(raw)


def _invoke_gemini(prompt: str, sys_msg: str) -> dict:
    import google.generativeai as genai

    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel(
        model_name=settings.gemini_model,
        system_instruction=sys_msg,
    )
    resp = model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"},
    )
    return json.loads(resp.text or "{}")


_INVOKERS: dict[ProviderName, Any] = {
    "openai": _invoke_openai,
    "anthropic": _invoke_anthropic,
    "gemini": _invoke_gemini,
}


class LLMInvokeBody(BaseModel):
    prompt: str = Field(max_length=10000)
    response_json_schema: dict[str, Any] | None = None
    provider: ProviderName | None = None


@router.post("/invoke")
def invoke_llm(body: LLMInvokeBody, user: User = Depends(get_current_user)):
    provider = _resolve_provider(body.provider)
    sys_msg = _system_message(body.response_json_schema)
    log.debug("llm/invoke using provider=%s", provider)
    try:
        return _INVOKERS[provider](body.prompt, sys_msg)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Model returned invalid JSON: {e}") from e
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/providers")
def list_providers(user: User = Depends(get_current_user)):
    """Return which providers have a key configured and which would be auto-selected."""
    av = _available()
    default = next((p for p in _PRIORITY if av[p]), None)
    return {**av, "default": default}
