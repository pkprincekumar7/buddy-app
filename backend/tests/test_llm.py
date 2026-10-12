"""Routes in app/routers/llm.py.

Only the provider SDK clients are faked (at llm_service's module boundary), so the
real provider resolution, system message, JSON parsing and per-user hourly quota
(app/llm_rate_limiter.py, in-memory backend) all run on every request.
"""

import json
import logging
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.llm_rate_limiter as llm_quota
from app.auth_utils import create_access_token
from app.database import get_db
from app.limiter import user_limiter
from app.main import app
from app.services import llm_service
from app.settings import settings

INVOKE = "/api/v1/llm/invoke"
PROVIDERS = "/api/v1/llm/providers"
PARENT = {"_id": "p1", "location": "eu", "role": "parent"}
PARENT2 = {"_id": "p2", "location": "eu", "role": "parent"}
ADMIN = {"_id": "a1", "location": "eu", "role": "admin"}


class _Users:
    def __init__(self):
        self.lookups = 0

    async def find_one(self, query):
        self.lookups += 1
        return next((u for u in (PARENT, PARENT2, ADMIN) if u["_id"] == query["_id"]), None)


# ── provider SDK fakes ───────────────────────────────────────────────────────


class _OpenAI:
    def __init__(self, content='{"answer": "openai"}', error=None, choices=True):
        self.content, self.error, self.with_choices, self.calls = content, error, choices, []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        message = SimpleNamespace(content=self.content)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message)] if self.with_choices else []
        )


class _Anthropic:
    def __init__(self, text='{"answer": "anthropic"}'):
        self.text, self.calls = text, []
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        content = [SimpleNamespace(text=self.text)] if self.text is not None else []
        return SimpleNamespace(content=content)


class _Gemini:
    def __init__(self, text='{"answer": "gemini"}'):
        self.text, self.models, self.calls = text, [], []

    def GenerativeModel(self, *, model_name, system_instruction):  # noqa: N802 — SDK's name
        self.models.append((model_name, system_instruction))
        return SimpleNamespace(generate_content=self._generate)

    def _generate(self, prompt, *, generation_config, request_options):
        self.calls.append((prompt, generation_config, request_options))
        return SimpleNamespace(text=self.text)


@pytest.fixture
def providers(monkeypatch):
    """No provider configured unless a test plugs one in via .use(...)."""
    for attr, value in (("_openai_client", None), ("_anthropic_client", None),
                        ("_genai", None), ("_gemini_configured", False)):  # fmt: skip
        monkeypatch.setattr(llm_service, attr, value)
    monkeypatch.setattr(llm_service, "_INIT_ERRORS", {"openai": None, "anthropic": None,
                                                      "gemini": None})  # fmt: skip

    def use(openai=None, anthropic=None, gemini=None):
        if openai:
            monkeypatch.setattr(llm_service, "_openai_client", openai)
        if anthropic:
            monkeypatch.setattr(llm_service, "_anthropic_client", anthropic)
        if gemini:
            monkeypatch.setattr(llm_service, "_genai", gemini)
            monkeypatch.setattr(llm_service, "_gemini_configured", True)

    return SimpleNamespace(use=use, init_errors=llm_service._INIT_ERRORS)


@pytest.fixture
def users(monkeypatch):
    users = _Users()
    app.dependency_overrides[get_db] = lambda: {"users": users}
    user_limiter.reset()
    # The real hourly quota, in-memory (no Redis), with a fresh state.
    monkeypatch.setattr(llm_quota, "_mem_log", {})
    monkeypatch.setattr(llm_quota, "_redis_client", None)
    monkeypatch.setattr(llm_quota, "_redis_init_attempted", True)
    monkeypatch.setattr(settings, "llm_hourly_limit", 100)
    try:
        yield users
    finally:
        app.dependency_overrides.pop(get_db, None)
        user_limiter.reset()


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user=PARENT):
    return {"Authorization": f"Bearer {create_access_token(user['_id'], user['location'])}"}


def _invoke(client, user=PARENT, **body):
    return client.post(INVOKE, json={"prompt": "How do I help with bedtime?", **body},
                       headers=_auth(user))  # fmt: skip


# ── POST /llm/invoke ─────────────────────────────────────────────────────────


def test_invoke_returns_the_providers_json(users, client, providers):
    openai = _OpenAI(content='{"tips": ["routine", "dim lights"]}')
    providers.use(openai=openai)
    schema = {"type": "object", "properties": {"tips": {"type": "array"}}}
    res = _invoke(client, response_json_schema=schema)
    assert (res.status_code, res.json()) == (200, {"tips": ["routine", "dim lights"]})
    [call] = openai.calls
    assert call["model"] == settings.openai_model
    assert call["response_format"] == {"type": "json_object"}
    assert call["timeout"] == settings.llm_timeout_seconds
    system, user_msg = call["messages"]
    assert user_msg == {"role": "user", "content": "How do I help with bedtime?"}
    assert system["role"] == "system" and "child-development assistant" in system["content"]
    assert json.dumps(schema) in system["content"]  # schema passed as data in the system prompt


def test_invoke_without_a_schema_sends_no_schema_hint(users, client, providers):
    openai = _OpenAI()
    providers.use(openai=openai)
    assert _invoke(client).status_code == 200
    assert "OUTPUT SCHEMA" not in openai.calls[0]["messages"][0]["content"]


def test_auto_selection_follows_the_provider_priority(users, client, providers):
    providers.use(anthropic=_Anthropic(), gemini=_Gemini())
    assert _invoke(client).json() == {"answer": "anthropic"}  # openai absent → anthropic


@pytest.mark.parametrize(
    ("provider", "expected"),
    [("openai", "openai"), ("anthropic", "anthropic"), ("gemini", "gemini")],
)
def test_explicit_provider_is_used(users, client, providers, provider, expected):
    fakes = {"openai": _OpenAI(), "anthropic": _Anthropic(), "gemini": _Gemini()}
    providers.use(**fakes)
    assert _invoke(client, provider=provider).json() == {"answer": expected}
    for name, fake in fakes.items():
        assert bool(fake.calls) is (name == provider)


def test_anthropic_and_gemini_requests(users, client, providers):
    anthropic, gemini = _Anthropic(), _Gemini()
    providers.use(anthropic=anthropic, gemini=gemini)
    _invoke(client, provider="anthropic")
    _invoke(client, provider="gemini")
    [a] = anthropic.calls
    assert (a["model"], a["max_tokens"]) == (settings.anthropic_model, 4096)
    assert a["messages"] == [{"role": "user", "content": "How do I help with bedtime?"}]
    assert "child-development assistant" in a["system"]
    [(model_name, system_instruction)] = gemini.models
    assert model_name == settings.gemini_model and "child-development" in system_instruction
    [(prompt, generation_config, request_options)] = gemini.calls
    assert prompt == "How do I help with bedtime?"
    assert generation_config == {"response_mime_type": "application/json"}
    assert request_options == {"timeout": settings.llm_timeout_seconds}


# -- failures --------------------------------------------------------------------


def test_no_provider_configured_is_503(users, client, providers, caplog):
    with caplog.at_level(logging.ERROR, logger="app.routers.llm"):
        res = _invoke(client)
    assert res.status_code == 503
    assert res.json()["detail"].startswith("No LLM provider is configured.")
    assert "provider_not_configured" in caplog.text


def test_requested_provider_not_configured_is_503(users, client, providers):
    providers.use(openai=_OpenAI())
    res = _invoke(client, provider="gemini")
    assert (res.status_code, res.json()["detail"]) == (
        503,
        "GEMINI_API_KEY is not configured on this server.",
    )


def test_requested_provider_that_failed_to_initialise_is_503_without_details(
    users, client, providers
):
    providers.init_errors["anthropic"] = "ImportError"
    res = _invoke(client, provider="anthropic")
    assert (res.status_code, res.json()["detail"]) == (
        503,
        "ANTHROPIC provider failed to initialise. Check server logs.",
    )
    assert "ImportError" not in res.text


@pytest.mark.parametrize(
    "fake",
    [
        _OpenAI(content="Sure! Here are some tips: secret-internal-note"),  # not JSON
        _OpenAI(content=None),  # empty content
        _OpenAI(choices=False),  # filtered response
    ],
)
def test_unusable_provider_output_is_a_generic_502(users, client, providers, caplog, fake):
    providers.use(openai=fake)
    with caplog.at_level(logging.WARNING, logger="app.routers.llm"):
        res = _invoke(client)
    assert (res.status_code, res.json()["detail"]) == (
        502,
        "LLM service returned an unexpected response.",
    )
    assert "secret-internal-note" not in res.text  # raw output stays in the log
    assert "error=invalid_json" in caplog.text


def test_anthropic_reply_without_text_is_502(users, client, providers):
    providers.use(anthropic=_Anthropic(text=None))
    res = _invoke(client, provider="anthropic")
    assert (res.status_code, res.json()["detail"]) == (
        502,
        "LLM service returned an unexpected response.",
    )


def test_provider_outage_is_a_generic_502(users, client, providers, caplog):
    providers.use(openai=_OpenAI(error=TimeoutError("upstream timed out; key=sk-live-123")))
    with caplog.at_level(logging.WARNING, logger="app.routers.llm"):
        res = _invoke(client)
    assert (res.status_code, res.json()["detail"]) == (
        502,
        "LLM service is temporarily unavailable.",
    )
    assert "sk-live-123" not in res.text
    assert "upstream timed out" in caplog.text


def test_http_errors_from_the_service_pass_through_unchanged(users, client, monkeypatch):
    async def invoke(**kwargs):
        raise HTTPException(status_code=418, detail="teapot")

    monkeypatch.setattr(llm_service, "invoke", invoke)
    res = _invoke(client)
    assert (res.status_code, res.json()["detail"]) == (418, "teapot")


# -- limits ----------------------------------------------------------------------


def test_hourly_llm_quota_is_per_user_and_checked_before_calling_the_provider(
    users, client, providers, monkeypatch
):
    monkeypatch.setattr(settings, "llm_hourly_limit", 2)
    openai = _OpenAI()
    providers.use(openai=openai)
    assert [_invoke(client).status_code for _ in range(2)] == [200, 200]
    res = _invoke(client)
    assert (res.status_code, res.json()["detail"]) == (
        429,
        "LLM rate limit exceeded: max 2 requests per hour.",
    )
    assert len(openai.calls) == 2  # the over-quota request never reached the provider
    assert _invoke(client, user=PARENT2).status_code == 200  # other users unaffected


def test_failed_calls_still_use_quota(users, client, providers, monkeypatch):
    # The quota counts attempts: a stream of failing prompts can't be retried forever.
    monkeypatch.setattr(settings, "llm_hourly_limit", 1)
    providers.use(openai=_OpenAI(content="not json"))
    assert _invoke(client).status_code == 502
    assert _invoke(client).status_code == 429


def test_invoke_is_limited_to_30_per_minute_before_the_user_lookup(users, client, providers):
    providers.use(openai=_OpenAI())
    for _ in range(30):
        assert _invoke(client).status_code == 200
    lookups = users.lookups
    assert _invoke(client).status_code == 429
    assert users.lookups == lookups


@pytest.mark.parametrize(
    "body",
    [
        {"prompt": "x" * 32001},
        {"prompt": "x", "provider": "mistral"},
        {"prompt": "x", "response_json_schema": {"d": "x" * 4000}},
        {"prompt": "x", "response_json_schema": {"$ref": "https://evil.example/s.json"}},
        {"prompt": "x", "response_json_schema": {"$ref": "//evil.example/s.json"}},
        {"prompt": "x", "response_json_schema": {"a": {"$ref": "http://evil.example/s"}}},
        {},
    ],
)
def test_invalid_requests_are_422_and_never_reach_a_provider(users, client, providers, body):
    openai = _OpenAI()
    providers.use(openai=openai)
    res = client.post(INVOKE, json=body, headers=_auth())
    assert res.status_code == 422
    assert openai.calls == []


def test_explicit_null_schema_and_internal_refs_are_allowed(users, client, providers):
    providers.use(openai=_OpenAI())
    assert _invoke(client, response_json_schema=None).status_code == 200
    schema = {"$ref": "#/definitions/tip", "definitions": {"tip": {"type": "string"}}}
    assert _invoke(client, response_json_schema=schema).status_code == 200


# -- access ----------------------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), [("post", INVOKE), ("get", PROVIDERS)])
def test_requires_a_token(users, client, providers, method, path):
    res = client.request(method, path, json={"prompt": "x"})
    assert (res.status_code, res.json()["detail"]) == (401, "Not authenticated")


@pytest.mark.parametrize(("method", "path"), [("post", INVOKE), ("get", PROVIDERS)])
def test_admins_cannot_use_llm_routes(users, client, providers, method, path):
    openai = _OpenAI()
    providers.use(openai=openai)
    res = client.request(method, path, json={"prompt": "x"}, headers=_auth(ADMIN))
    assert (res.status_code, res.json()["detail"]) == (403, "Not available for admin accounts")
    assert openai.calls == []


# ── GET /llm/providers ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("configured", "default"),
    [
        ({"openai", "anthropic", "gemini"}, "openai"),
        ({"anthropic", "gemini"}, "anthropic"),
        ({"gemini"}, "gemini"),
        (set(), None),
    ],
)
def test_providers_lists_availability_and_the_default(
    users, client, providers, configured, default
):
    fakes = {"openai": _OpenAI(), "anthropic": _Anthropic(), "gemini": _Gemini()}
    providers.use(**{name: fakes[name] for name in configured})
    res = client.get(PROVIDERS, headers=_auth())
    assert res.status_code == 200
    assert res.json() == {
        "openai": "openai" in configured,
        "anthropic": "anthropic" in configured,
        "gemini": "gemini" in configured,
        "default": default,
    }


def test_providers_is_limited_to_60_per_minute_before_the_user_lookup(users, client, providers):
    for _ in range(60):
        assert client.get(PROVIDERS, headers=_auth()).status_code == 200
    lookups = users.lookups
    assert client.get(PROVIDERS, headers=_auth()).status_code == 429
    assert users.lookups == lookups
