"""The LLM provider client for the generating services (docs/auth-users-split.md, 8, 15.5).

Today's `app/services/llm_service.py`, as a class a service builds once: OpenAI, Anthropic
or Gemini (the first configured, unless one is asked for), JSON output only, a timeout on
every call. Each call logs one structured `llm_call` line (circle, provider, model, tokens,
duration, outcome), which the Logs Insights cost query sums. Prompts and answers are never
logged.

The provider SDKs come with the `[generation]` extra; only the workers of discover, grow,
transform and release get LLM keys.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from common.generation.prompts import system_message

ProviderName = Literal["openai", "anthropic", "gemini"]
PRIORITY: tuple[ProviderName, ...] = ("openai", "anthropic", "gemini")
# Gemini gets its own timeout as well, on top of the SDK's: its call runs in a thread.
GEMINI_GRACE_SECONDS = 5.0

_logger = logging.getLogger(__name__)


class LlmConfigError(Exception):
    """No usable provider. Permanent: fail the job at once instead of using its retries."""


class LlmResponseError(ValueError):
    """The provider answered with nothing usable (empty, filtered, not JSON). Retryable."""


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
            openai_api_key=environ.get("OPENAI_API_KEY", ""),
            openai_model=environ.get("OPENAI_MODEL", defaults.openai_model),
            anthropic_api_key=environ.get("ANTHROPIC_API_KEY", ""),
            anthropic_model=environ.get("ANTHROPIC_MODEL", defaults.anthropic_model),
            gemini_api_key=environ.get("GEMINI_API_KEY", ""),
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
        gemini_module: Any = None,
    ) -> None:
        """Clients may be passed in (tests); otherwise each is built from its key, if set."""
        self.config = config
        self.circle = circle
        self._openai = openai_client if openai_client is not None else self._build_openai()
        self._anthropic = (
            anthropic_client if anthropic_client is not None else self._build_anthropic()
        )
        self._gemini = gemini_module if gemini_module is not None else self._build_gemini()

    def _build_openai(self) -> Any:
        if not self.config.openai_api_key:
            return None
        from openai import AsyncOpenAI

        return AsyncOpenAI(api_key=self.config.openai_api_key)

    def _build_anthropic(self) -> Any:
        if not self.config.anthropic_api_key:
            return None
        import anthropic

        return anthropic.AsyncAnthropic(api_key=self.config.anthropic_api_key)

    def _build_gemini(self) -> Any:
        if not self.config.gemini_api_key:
            return None
        import google.generativeai as genai

        genai.configure(api_key=self.config.gemini_api_key)
        return genai

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

    async def invoke(
        self,
        prompt: str,
        *,
        schema: dict[str, Any] | None = None,
        provider: ProviderName | None = None,
    ) -> LlmResult:
        """Run one generation and return its JSON object. Logs one `llm_call` line either way."""
        resolved = self.resolve(provider)
        model = self.config.model(resolved)
        started = time.monotonic()
        outcome, result = "error", None
        try:
            result = await {
                "openai": self._call_openai,
                "anthropic": self._call_anthropic,
                "gemini": self._call_gemini,
            }[resolved](prompt, system_message(schema), model)
            outcome = "ok"
            return result
        except TimeoutError:
            outcome = "timeout"
            raise
        except LlmResponseError:
            outcome = "bad_response"
            raise
        finally:
            _logger.info(
                json.dumps(
                    {
                        "llm_call": {
                            "circle": self.circle,
                            "provider": resolved,
                            "model": model,
                            "input_tokens": result.input_tokens if result else None,
                            "output_tokens": result.output_tokens if result else None,
                            "duration_ms": round((time.monotonic() - started) * 1000),
                            "outcome": outcome,
                        }
                    },
                    sort_keys=True,
                )
            )

    async def _call_openai(self, prompt: str, system: str, model: str) -> LlmResult:
        completion = await self._openai.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            timeout=self.config.timeout_seconds,
        )
        if not completion.choices:
            raise LlmResponseError(
                "openai returned no choices (the response may have been filtered)"
            )
        usage = getattr(completion, "usage", None)
        return LlmResult(
            _parse_json(completion.choices[0].message.content, "openai"),
            "openai",
            model,
            getattr(usage, "prompt_tokens", None),
            getattr(usage, "completion_tokens", None),
        )

    async def _call_anthropic(self, prompt: str, system: str, model: str) -> LlmResult:
        message = await self._anthropic.messages.create(
            model=model,
            max_tokens=self.config.max_output_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            timeout=self.config.timeout_seconds,
        )
        block = message.content[0] if message.content else None
        usage = getattr(message, "usage", None)
        return LlmResult(
            _parse_json(getattr(block, "text", None), "anthropic"),
            "anthropic",
            model,
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
        )

    async def _call_gemini(self, prompt: str, system: str, model: str) -> LlmResult:
        def call() -> Any:
            generative = self._gemini.GenerativeModel(model_name=model, system_instruction=system)
            return generative.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
                request_options={"timeout": self.config.timeout_seconds},
            )

        # The Gemini SDK is synchronous; a thread keeps the worker's event loop free.
        response = await asyncio.wait_for(
            asyncio.to_thread(call), self.config.timeout_seconds + GEMINI_GRACE_SECONDS
        )
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
