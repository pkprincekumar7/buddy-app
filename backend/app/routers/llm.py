import json
import logging
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.deps import get_current_user
from app.models import User
from app.settings import settings

# ---------------------------------------------------------------------------
# Per-user rate limiting (in-memory sliding window)
# ---------------------------------------------------------------------------

_LLM_MAX_CALLS_PER_HOUR = 50
_LLM_WINDOW_SECONDS = 3600

_user_call_log: dict[str, deque] = defaultdict(deque)
_rate_limit_lock = Lock()


def _enforce_user_rate_limit(user_id: str) -> None:
    now = time.monotonic()
    cutoff = now - _LLM_WINDOW_SECONDS
    with _rate_limit_lock:
        dq = _user_call_log[user_id]
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= _LLM_MAX_CALLS_PER_HOUR:
            raise HTTPException(
                status_code=429,
                detail=f"LLM rate limit exceeded: max {_LLM_MAX_CALLS_PER_HOUR} requests per hour.",
            )
        dq.append(now)

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
        timeout=settings.llm_timeout_seconds,
    )
    return json.loads(comp.choices[0].message.content or "{}")


def _parse_json(raw: str | None, provider: str) -> dict:
    text = raw or "{}"
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        # Re-raise as ValueError so the outer handler includes the raw snippet.
        raise ValueError(
            f"LLM ({provider}) returned non-JSON — raw={text[:400]!r}"
        ) from exc


def _invoke_anthropic(prompt: str, sys_msg: str) -> dict:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=sys_msg,
        messages=[{"role": "user", "content": prompt}],
        timeout=settings.llm_timeout_seconds,
    )
    block = msg.content[0] if msg.content else None
    raw = block.text if (block is not None and hasattr(block, "text")) else None
    return _parse_json(raw, "anthropic")


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
        request_options={"timeout": settings.llm_timeout_seconds},
    )
    return _parse_json(getattr(resp, "text", None), "gemini")


_INVOKERS: dict[ProviderName, Any] = {
    "openai": _invoke_openai,
    "anthropic": _invoke_anthropic,
    "gemini": _invoke_gemini,
}


class LLMInvokeBody(BaseModel):
    prompt: str = Field(max_length=10000)
    response_json_schema: dict[str, Any] | None = None
    provider: ProviderName | None = None

    @field_validator("response_json_schema")
    @classmethod
    def validate_schema_size(cls, v: dict | None) -> dict | None:
        if v is not None and len(json.dumps(v)) > 4000:
            raise ValueError("response_json_schema must not exceed 4000 characters when serialised")
        return v


@router.post("/invoke")
def invoke_llm(body: LLMInvokeBody, user: User = Depends(get_current_user)):
    _enforce_user_rate_limit(user.id)
    provider = _resolve_provider(body.provider)
    sys_msg = _system_message(body.response_json_schema)
    log.debug("llm.invoke provider=%s", provider)
    try:
        return _INVOKERS[provider](body.prompt, sys_msg)
    except json.JSONDecodeError as e:
        log.warning("llm.invoke.error provider=%s error=invalid_json detail=%s", provider, e)
        raise HTTPException(status_code=502, detail="LLM service returned an unexpected response.") from e
    except HTTPException:
        raise
    except Exception as e:
        log.warning("llm.invoke.error provider=%s error=%s", provider, e)
        raise HTTPException(status_code=502, detail="LLM service is temporarily unavailable.") from e


@router.get("/providers")
def list_providers(user: User = Depends(get_current_user)):
    """Return which providers have a key configured and which would be auto-selected."""
    av = _available()
    default = next((p for p in _PRIORITY if av[p]), None)
    return {**av, "default": default}
