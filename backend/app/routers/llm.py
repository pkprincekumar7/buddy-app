import asyncio
import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.deps import CurrentParent, get_current_parent, get_token_claims
from app.limiter import rate_limit
from app.llm_rate_limiter import enforce as _enforce_user_rate_limit
from app.services import llm_service
from app.services.llm_service import LLMConfigError, ProviderName

# Every route needs a validly-signed access token — declared at the router
# level as a safety net. This is only the DB-free half of auth
# (app.deps.get_token_claims). invoke_llm pulls in the DB-backed half via its
# own `user: CurrentParent` parameter; list_providers doesn't need the user
# document, so it re-adds get_current_parent explicitly per-route below.
# Both are deliberately *not* also listed here, so they resolve after each
# route's rate_limit(...) dependency instead of before.
router = APIRouter(prefix="/llm", tags=["llm"], dependencies=[Depends(get_token_claims)])
log = logging.getLogger(__name__)


class LLMInvokeBody(BaseModel):
    prompt: str = Field(max_length=32000)
    response_json_schema: dict[str, Any] | None = None
    provider: ProviderName | None = None

    @field_validator("response_json_schema")
    @classmethod
    def validate_schema_size(cls, v: dict | None) -> dict | None:
        if v is None:
            return v
        serialised = json.dumps(v)
        if len(serialised) > 4000:
            raise ValueError("response_json_schema must not exceed 4000 characters when serialised")
        # Reject external $ref URIs (absolute and protocol-relative) — they could
        # trigger SSRF if the schema were ever passed to a validator that resolves
        # references. Protocol-relative ("//evil.com") is also rejected because some
        # validators resolve those as network URIs under the current document scheme.
        if re.search(r'"\\?\$ref"\s*:\s*"(?:https?:)?//', serialised):
            raise ValueError("response_json_schema must not contain external $ref URIs")
        return v


@router.post(
    "/invoke",
    description="Send a prompt to the configured LLM provider and return the structured response.",
    dependencies=[Depends(rate_limit("30/minute"))],
)
async def invoke_llm(request: Request, body: LLMInvokeBody, user: CurrentParent):
    await asyncio.to_thread(_enforce_user_rate_limit, user["_id"])
    try:
        return await llm_service.invoke(
            prompt=body.prompt,
            schema=body.response_json_schema,
            provider=body.provider,
        )
    except LLMConfigError as e:
        log.error("llm.invoke.error error=provider_not_configured detail=%s", e)
        raise HTTPException(status_code=503, detail=str(e)) from e
    except (json.JSONDecodeError, ValueError) as e:
        log.warning("llm.invoke.error error=invalid_json detail=%s", e)
        raise HTTPException(
            status_code=502, detail="LLM service returned an unexpected response."
        ) from e
    except HTTPException:
        raise
    except Exception as e:
        log.warning("llm.invoke.error error=%s", e)
        raise HTTPException(
            status_code=502, detail="LLM service is temporarily unavailable."
        ) from e


@router.get(
    "/providers",
    dependencies=[Depends(rate_limit("60/minute")), Depends(get_current_parent)],
)
async def list_providers(request: Request):
    """Return which providers have a key configured and which would be auto-selected."""
    av = llm_service.available()
    default = next((p for p in llm_service.PRIORITY if av[p]), None)
    return {**av, "default": default}
