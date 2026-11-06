"""The LLM provider client for the generating services (docs/auth-users-split.md, 8, 15.5).

A class a service builds once: OpenAI, Anthropic or Gemini (the first configured, unless
one is asked for), JSON output only, a timeout and an output-token cap on every call. Each
call logs one structured `llm_call` line (circle, provider, model, tokens, duration,
outcome), which the Logs Insights cost query sums. Prompts and answers are never logged.

The SDKs' own retries are off: a generation job already retries a failed call (its
attempts, common.generation.jobs), so SDK retries on top would multiply the calls one job
can make, and their cost (production-readiness review, JOB-02).

A call that fails at one provider is tried at the next one configured, in PRIORITY order
(JOB-04): an OpenAI 429 or outage no longer fails the job while Anthropic or Gemini could
answer. A provider whose call errored or timed out is then skipped for BREAKER_SECONDS (a
circuit breaker, per task), so later calls don't wait on it; an unusable answer falls back
too but doesn't trip it. A provider asked for by name gets no fallback.

One invoke() has one time budget, LlmConfig.timeout_seconds (LLM_TIMEOUT_SECONDS),
fallbacks included (APP-03): each provider gets what's left of it, and a hard
asyncio.timeout ends the call there even if the SDK's own timeout (which applies per read,
not to the whole call) hasn't. A stopping worker gets LLM_TIMEOUT_SECONDS + 30 s and the
ALB drains for as long (infra-live-backend), so a fallback can't outlast either. Gemini
runs on the async google-genai SDK (its client.aio), as OpenAI and Anthropic do, so a
timed-out Gemini call is cancelled, not left running on a thread.

The provider SDKs come with the `[generation]` extra; only the workers of discover, grow,
transform and release get LLM keys.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from common.generation.prompts import system_message
from common.settings_base import filled

ProviderName = Literal["openai", "anthropic", "gemini"]
PRIORITY: tuple[ProviderName, ...] = ("openai", "anthropic", "gemini")
# How long a provider that failed is skipped for (JOB-04).
BREAKER_SECONDS = 60.0

_logger = logging.getLogger(__name__)


class LlmConfigError(Exception):
    """No usable provider. Permanent: fail the job at once instead of using its retries."""


class LlmResponseError(ValueError):
    """The provider answered with nothing usable (empty, filtered, not JSON). Retryable."""


# The JSON would be cut off, so it's refused before parsing, with the reason in the log.
_CAPPED = "{provider} stopped at the output-token cap (LlmConfig.max_output_tokens)"


@dataclass(frozen=True)
class LlmConfig:
    openai_api_key: str = ""
    openai_model: str = "gpt-5.4-mini"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3-flash"
    timeout_seconds: float = 60.0
    max_output_tokens: int = 4096

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> LlmConfig:
        defaults = cls()
        return cls(
            # A provider with no key yet is unconfigured, not one to call and fail.
            openai_api_key=filled(environ.get("OPENAI_API_KEY")),
            openai_model=environ.get("OPENAI_MODEL", defaults.openai_model),
            anthropic_api_key=filled(environ.get("ANTHROPIC_API_KEY")),
            anthropic_model=environ.get("ANTHROPIC_MODEL", defaults.anthropic_model),
            gemini_api_key=filled(environ.get("GEMINI_API_KEY")),
            gemini_model=environ.get("GEMINI_MODEL", defaults.gemini_model),
            timeout_seconds=float(environ.get("LLM_TIMEOUT_SECONDS", defaults.timeout_seconds)),
        )

    def model(self, provider: ProviderName) -> str:
        return {
            "openai": self.openai_model,
            "anthropic": self.anthropic_model,
            "gemini": self.gemini_model,
        }[provider]


@dataclass(frozen=True)
class LlmResult:
    data: dict[str, Any]
    provider: ProviderName
    model: str
    input_tokens: int | None
    output_tokens: int | None


def _parse_json(raw: str | None, provider: str) -> dict[str, Any]:
    if not raw:
        raise LlmResponseError(f"{provider} returned no content")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LlmResponseError(f"{provider} returned non-JSON") from exc
    if not isinstance(data, dict):
        raise LlmResponseError(f"{provider} returned JSON that isn't an object")
    return data


class LlmClient:
    def __init__(
        self,
        config: LlmConfig,
        *,
        circle: str,
        openai_client: Any = None,
        anthropic_client: Any = None,
        gemini_client: Any = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Clients may be passed in (tests); otherwise each is built from its key, if set."""
        self.config = config
        self.circle = circle
        self.clock = clock
        self._down_until: dict[ProviderName, float] = {}
        self._openai = openai_client if openai_client is not None else self._build_openai()
        self._anthropic = (
            anthropic_client if anthropic_client is not None else self._build_anthropic()
        )
        self._gemini = gemini_client if gemini_client is not None else self._build_gemini()

    def _build_openai(self) -> Any:
        if not self.config.openai_api_key:
            return None
        from openai import AsyncOpenAI

        return AsyncOpenAI(api_key=self.config.openai_api_key, max_retries=0)

    def _build_anthropic(self) -> Any:
        if not self.config.anthropic_api_key:
            return None
        import anthropic

        return anthropic.AsyncAnthropic(api_key=self.config.anthropic_api_key, max_retries=0)

    def _build_gemini(self) -> Any:
        """google-genai's async client. It retries nothing unless asked (no retry_options)."""
        if not self.config.gemini_api_key:
            return None
        from google import genai

        return genai.Client(api_key=self.config.gemini_api_key).aio

    def available(self) -> dict[ProviderName, bool]:
        return {
            "openai": self._openai is not None,
            "anthropic": self._anthropic is not None,
            "gemini": self._gemini is not None,
        }

    def resolve(self, preferred: ProviderName | None = None) -> ProviderName:
        available = self.available()
        if preferred is not None:
            if not available[preferred]:
                raise LlmConfigError(
                    f"{preferred.upper()}_API_KEY is not configured on this server"
                )
            return preferred
        for provider in PRIORITY:
            if available[provider]:
                return provider
        raise LlmConfigError(
            "no LLM provider is configured (OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY)"
        )

    def candidates(self, preferred: ProviderName | None = None) -> list[ProviderName]:
        """The providers to try, in order: the one asked for alone, else every configured
        one in PRIORITY order without those the breaker skips (all of them, in order, if
        it skips every one: better a call that may fail than none)."""
        if preferred is not None:
            return [self.resolve(preferred)]
        self.resolve()  # LlmConfigError when none is configured
        configured = [p for p, ok in self.available().items() if ok]
        configured.sort(key=PRIORITY.index)
        now = self.clock()
        healthy = [p for p in configured if now >= self._down_until.get(p, 0.0)]
        return healthy or configured

    async def invoke(
        self,
        prompt: str,
        *,
        schema: dict[str, Any] | None = None,
        provider: ProviderName | None = None,
    ) -> LlmResult:
        """Run one generation and return its JSON object, falling back to the next provider
        on a failure (JOB-04) while the call's time budget lasts (APP-03). Logs one
        `llm_call` line per provider tried; raises the last provider's error."""
        candidates = self.candidates(provider)
        deadline = time.monotonic() + self.config.timeout_seconds
        error: Exception | None = None
        for attempt, resolved in enumerate(candidates, start=1):
            budget = deadline - time.monotonic()
            if error is not None and budget <= 0:
                _logger.warning(
                    "LLM time budget (%ss) spent; not trying %s",
                    self.config.timeout_seconds,
                    resolved,
                )
                break
            try:
                return await self._invoke_one(resolved, prompt, schema, attempt, budget)
            except Exception as exc:
                self._failed(resolved, exc)
                error = exc
                if attempt < len(candidates):
                    _logger.warning(
                        "LLM %s failed (%s); trying the next provider",
                        resolved,
                        type(exc).__name__,
                    )
        assert error is not None  # candidates() is never empty
        raise error

    def _failed(self, provider: ProviderName, exc: Exception) -> None:
        """Trip the breaker for an outage (an error or timeout), not for one unusable answer."""
        if not isinstance(exc, LlmResponseError):
            self._down_until[provider] = self.clock() + BREAKER_SECONDS

    async def _invoke_one(
        self,
        resolved: ProviderName,
        prompt: str,
        schema: dict[str, Any] | None,
        attempt: int,
        budget: float,
    ) -> LlmResult:
        model = self.config.model(resolved)
        started = time.monotonic()
        outcome, result = "error", None
        try:
            async with asyncio.timeout(budget):
                result = await {
                    "openai": self._call_openai,
                    "anthropic": self._call_anthropic,
                    "gemini": self._call_gemini,
                }[resolved](prompt, system_message(schema), model, budget)
            outcome = "ok"
            return result
        except TimeoutError:
            outcome = "timeout"
            raise
        except LlmResponseError:
            outcome = "bad_response"
            raise
        finally:
            # A top-level `llm_call` field of the JSON log line (common.logging), so the
            # CloudWatch metric filters can sum its tokens per circle (JOB-03) and Logs
            # Insights queries read it as fields.
            call = {
                "circle": self.circle,
                "provider": resolved,
                "model": model,
                "input_tokens": result.input_tokens if result else None,
                "output_tokens": result.output_tokens if result else None,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "outcome": outcome,
                "attempt": attempt,  # >1: a fallback (JOB-04)
            }
            _logger.info(
                "llm_call circle=%s provider=%s outcome=%s",
                self.circle,
                resolved,
                outcome,
                extra={"llm_call": call},
            )

    async def _call_openai(self, prompt: str, system: str, model: str, budget: float) -> LlmResult:
        completion = await self._openai.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            # max_completion_tokens, not max_tokens: reasoning models accept only this one.
            max_completion_tokens=self.config.max_output_tokens,
            timeout=budget,
        )
        if not completion.choices:
            raise LlmResponseError(
                "openai returned no choices (the response may have been filtered)"
            )
        if getattr(completion.choices[0], "finish_reason", None) == "length":
            raise LlmResponseError(_CAPPED.format(provider="openai"))
        usage = getattr(completion, "usage", None)
        return LlmResult(
            _parse_json(completion.choices[0].message.content, "openai"),
            "openai",
            model,
            getattr(usage, "prompt_tokens", None),
            getattr(usage, "completion_tokens", None),
        )

    async def _call_anthropic(
        self, prompt: str, system: str, model: str, budget: float
    ) -> LlmResult:
        message = await self._anthropic.messages.create(
            model=model,
            max_tokens=self.config.max_output_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            timeout=budget,
        )
        if getattr(message, "stop_reason", None) == "max_tokens":
            raise LlmResponseError(_CAPPED.format(provider="anthropic"))
        block = message.content[0] if message.content else None
        usage = getattr(message, "usage", None)
        return LlmResult(
            _parse_json(getattr(block, "text", None), "anthropic"),
            "anthropic",
            model,
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
        )

    async def _call_gemini(self, prompt: str, system: str, model: str, budget: float) -> LlmResult:
        response = await self._gemini.models.generate_content(
            model=model,
            contents=prompt,
            config={
                "system_instruction": system,
                "response_mime_type": "application/json",
                "max_output_tokens": self.config.max_output_tokens,
                # Milliseconds; _invoke_one's timeout is the hard stop.
                "http_options": {"timeout": max(1, int(budget * 1000))},
            },
        )
        candidates = getattr(response, "candidates", None) or []
        finish = getattr(candidates[0], "finish_reason", None) if candidates else None
        if getattr(finish, "value", finish) == "MAX_TOKENS":
            raise LlmResponseError(_CAPPED.format(provider="gemini"))
        usage = getattr(response, "usage_metadata", None)
        return LlmResult(
            _parse_json(getattr(response, "text", None), "gemini"),
            "gemini",
            model,
            getattr(usage, "prompt_token_count", None),
            getattr(usage, "candidates_token_count", None),
        )

    async def aclose(self) -> None:
        for client in (self._openai, self._anthropic):
            close = getattr(client, "close", None)
            if close is not None:
                await close()
        close = getattr(self._gemini, "aclose", None)
        if close is not None:
            await close()
