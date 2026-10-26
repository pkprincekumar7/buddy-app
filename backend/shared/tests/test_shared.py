"""The shared service (build plan 5.6; named `platform` in the proposal). The plan's checks:
- the audio is never stored or logged;
- the APK link expires in 300 s.
Plus parents only, the limits, the build's health, and configuration."""

import asyncio
import dataclasses
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.routing import APIRoute
from shared_testkit import (
    ADMIN,
    BUCKET,
    JWT_PUBLIC,
    KID,
    SHARED_PRIVATE,
    Running,
    auth_header,
    running,
)

from common.routers import assert_every_route_has_a_policy
from shared.app import main
from shared.app.runtime import Runtime

SPEECH = "/api/v1/speech/transcriptions"
APK = "/api/v1/downloads/apk"


def live(test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(**options) as r:
            await test(r)

    asyncio.run(go())


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _speak(
    r: Running,
    content: bytes = b"RIFF fake audio",
    filename: str = "voice.webm",
    user: str | None = None,
) -> httpx.Response:
    headers = auth_header(user) if user else auth_header()
    return await r.http.post(
        SPEECH, files={"audio": (filename, content, "text/plain")}, headers=headers
    )


def test_every_route_declares_a_policy_and_stays_on_its_app():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)
    public = {r.path for r in main.app.routes if isinstance(r, APIRoute)}
    assert public == {"/health", "/api/health", SPEECH, APK}
    internal = {r.path for r in main.internal_app.routes if isinstance(r, APIRoute)}
    assert internal == {"/internal/ping"}


def _public(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://s"
        ) as http:
            return await http.request(method, path, **kwargs)

    return asyncio.run(go())


def test_the_health_checks_answer_even_unconfigured():
    assert _public("GET", "/health").json() == {"status": "ok", "service": "shared"}
    body = _public("GET", "/api/health").json()
    assert body["status"] == "ok" and set(body) == {
        "status",
        "commit",
        "branch",
        "committed_at",
        "tag",
    }
    assert _public("GET", APK, headers=auth_header()).status_code == 503


def test_build_info_as_today():
    assert main.build_info({}) == {
        "commit": "unknown", "branch": "unknown", "committed_at": "unknown", "tag": None,
    }  # fmt: skip
    built = main.build_info(
        {"GIT_SHA": "a1b2c3d", "GIT_BRANCH": "main", "GIT_COMMITTED_AT": "t", "GIT_TAG": ""}
    )
    assert built["commit"] == "a1b2c3d" and built["tag"] is None


def test_health_is_limited_to_30_a_minute_per_address():
    async def test(r: Running) -> None:
        statuses = [(await r.http.get("/api/health")).status_code for _ in range(31)]
        assert statuses.count(429) == 1 and statuses[-1] == 429

    live(test)


# ── speech-to-text ─────────────────────────────────────────────────────────────


def test_a_recording_becomes_text_and_is_neither_kept_nor_logged(caplog):
    async def test(r: Running) -> None:
        with caplog.at_level(logging.DEBUG):
            response = await _speak(r, b"secret family audio", filename="Jane's voice.m4a")
        assert response.json() == {"transcript": "He gets upset when his tower falls over"}
        (call,) = r.openai.calls
        name, file, mime = call["file"]
        # A fixed name and the allow-listed type: never the parent's filename or Content-Type.
        assert (name, mime, call["model"], call["language"]) == (
            "recording.m4a",
            "audio/mp4",
            "whisper-1",
            "en",
        )
        assert file.read() == b"secret family audio"
        assert "secret family audio" not in caplog.text and "Jane" not in caplog.text

    live(test)


@pytest.mark.parametrize(
    ("filename", "sent_as"),
    [
        ("voice.MP3", "recording.mp3"),
        ("no_extension", "recording.webm"),
        ("", "recording.webm"),
    ],
)
def test_the_type_comes_from_the_last_extension(filename, sent_as):
    async def test(r: Running) -> None:
        if filename == "":
            # No filename at all: httpx sends the field as a plain value, so send a bare file.
            response = await r.http.post(
                SPEECH, files={"audio": ("x", b"a")}, headers=auth_header()
            )
            assert response.status_code == 200
            assert main._audio_type(None) == "webm"
            return
        assert (await _speak(r, filename=filename)).status_code == 200
        assert r.openai.calls[-1]["file"][0] == sent_as

    live(test)


def test_control_characters_are_stripped_before_the_extension_is_read():
    # httpx percent-escapes CR and LF in a filename, so this one is checked directly.
    assert main._audio_type("voice.mp3\r\n") == "mp3"
    assert main._audio_type("\x00") == "webm"


def test_refusals(caplog):
    async def test(r: Running) -> None:
        too_big = await _speak(r, b"x" * (10 * 1024 * 1024 + 1))
        assert too_big.status_code == 413 and _code(too_big) == "audio_too_large"
        exe = await _speak(r, filename="voice.webm\x00.exe")
        assert exe.status_code == 415 and _code(exe) == "unsupported_audio_type"
        admin = await _speak(r, user=ADMIN)
        assert admin.status_code == 403 and _code(admin) == "parents_only"
        assert (await r.http.post(SPEECH, files={"audio": ("v.webm", b"a")})).status_code == 401
        assert r.openai.calls == []
        r.openai.error = RuntimeError("upstream timeout with secret audio inside")
        with caplog.at_level(logging.WARNING):
            down = await _speak(r)
        assert down.status_code == 502 and _code(down) == "transcription_unavailable"
        assert "RuntimeError" in caplog.text and "secret audio" not in caplog.text

    live(test)


def test_speech_without_a_key_is_503_and_limited_to_10_a_minute():
    async def unconfigured(r: Running) -> None:
        response = await _speak(r)
        assert response.status_code == 503 and _code(response) == "transcription_not_configured"

    live(unconfigured, openai=False)

    async def limited(r: Running) -> None:
        statuses = [(await _speak(r)).status_code for _ in range(11)]
        assert statuses.count(429) == 1 and statuses[-1] == 429

    live(limited)


# ── the APK link ───────────────────────────────────────────────────────────────


def test_the_newest_apk_link_expires_in_300_seconds():
    async def test(r: Running) -> None:
        missing = await r.http.get(APK, headers=auth_header())
        assert missing.status_code == 404 and _code(missing) == "apk_not_available"
        for key in (
            "app-assets/applications/android/app-release-2026-10-01-10-00-00.apk",
            "app-assets/applications/android/app-release-2026-10-20-09-30-00.apk",
            "app-assets/applications/android/notes.txt",
        ):
            r.s3.put_object(Bucket=BUCKET, Key=key, Body=b"apk")
        body = (await r.http.get(APK, headers=auth_header())).json()
        assert body["filename"] == "superpower-android.apk" and body["expires_in"] == 300
        url = urlsplit(body["url"])
        query = parse_qs(url.query)
        assert url.path.endswith("app-release-2026-10-20-09-30-00.apk")
        assert query["X-Amz-Expires"] == ["300"]
        assert query["response-content-disposition"] == [
            'attachment; filename="superpower-android.apk"'
        ]
        admin = await r.http.get(APK, headers=auth_header(ADMIN))
        assert admin.status_code == 403 and _code(admin) == "parents_only"

    live(test)


def test_apk_refusals():
    async def unconfigured(r: Running) -> None:
        response = await r.http.get(APK, headers=auth_header())
        assert response.status_code == 503 and _code(response) == "downloads_not_configured"

    live(unconfigured, assets=False)

    async def unreachable(r: Running) -> None:
        r.s3.delete_bucket(Bucket=BUCKET)
        response = await r.http.get(APK, headers=auth_header())
        assert response.status_code == 503 and _code(response) == "downloads_unavailable"

    live(unreachable)


# ── configuration ──────────────────────────────────────────────────────────────


def _env(**extra: str) -> dict[str, str]:
    return {
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "s1",
        "INTERNAL_SIGNING_KEY": SHARED_PRIVATE,
        **extra,
    }


def test_from_env_needs_no_database(fake_aws_credentials, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    for name in ("REDIS_URL", "OPENAI_API_KEY", "ASSETS_BUCKET_NAME", "MONGODB_URI"):
        monkeypatch.delenv(name, raising=False)
    plain = Runtime.from_env(_env())
    assert plain.settings.service_name == "shared" and plain.openai is None and plain.s3 is None
    asyncio.run(plain.aclose())
    full = Runtime.from_env(
        _env(
            OPENAI_API_KEY="test-key-not-real",
            ASSETS_BUCKET_NAME=BUCKET,
            AWS_ENDPOINT_URL="http://localhost:5050",
        )
    )
    assert full.openai is not None and full.s3.meta.endpoint_url == "http://localhost:5050"
    asyncio.run(full.aclose())
    aws = Runtime.from_env(_env(ASSETS_BUCKET_NAME=BUCKET))
    assert aws.s3.meta.endpoint_url == "https://s3.us-east-1.amazonaws.com"


def test_the_lifespan_shares_one_runtime(fake_aws_credentials, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    for key, value in _env().items():
        monkeypatch.setenv(key, value)

    async def run() -> None:
        async with (
            main.app.router.lifespan_context(main.app),
            main.internal_app.router.lifespan_context(main.internal_app),
        ):
            assert main.app.state.runtime is main.internal_app.state.runtime is not None
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.internal_app), base_url="http://s"
            ) as internal:
                assert (await internal.get("/internal/ping")).json()["service"] == "shared"
        assert main.app.state.runtime is None

    asyncio.run(run())
    monkeypatch.delenv("JWT_PUBLIC_KEYS")

    async def unconfigured() -> None:
        async with main.app.router.lifespan_context(main.app):
            assert main.app.state.runtime is None

    asyncio.run(unconfigured())


class _Cache:
    closed = False

    async def aclose(self) -> None:
        self.closed = True


def test_closing_closes_the_openai_client_and_the_cache():
    async def test(r: Running) -> None:
        cache = _Cache()
        await dataclasses.replace(r.runtime, cache=cache).aclose()
        assert r.openai.closed and cache.closed

    live(test)
