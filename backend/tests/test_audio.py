import asyncio
import io
import logging
from types import SimpleNamespace

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient

import app.routers.audio as audio
from app import models
from app.auth_utils import create_access_token
from app.database import get_db
from app.limiter import user_limiter
from app.main import app
from app.settings import settings

PARENT = {"_id": "p1", "location": "eu", "role": "parent"}
ADMIN = {"_id": "a1", "location": "in", "role": "admin"}
URL = "/api/v1/audio/transcribe"
MAX_BYTES = 10 * 1024 * 1024


class _Users:
    def __init__(self):
        self.lookups = 0

    async def find_one(self, query):
        self.lookups += 1
        return next((u for u in (PARENT, ADMIN) if u["_id"] == query["_id"]), None)


class _Transcriptions:
    """Stands in for openai.AsyncOpenAI().audio.transcriptions."""

    def __init__(self, text="hello world", error: Exception | None = None):
        self.text, self.error, self.calls = text, error, []

    async def create(self, *, model, file, language):
        name, buffer, mime = file
        self.calls.append(
            {
                "model": model,
                "name": name,
                "bytes": buffer.read(),
                "mime": mime,
                "language": language,
            }
        )
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.text)


@pytest.fixture
def users():
    users = _Users()
    app.dependency_overrides[get_db] = lambda: {models.USERS: users}
    user_limiter.reset()
    try:
        yield users
    finally:
        app.dependency_overrides.pop(get_db, None)
        user_limiter.reset()


@pytest.fixture
def openai(monkeypatch):
    transcriptions = _Transcriptions()
    client = SimpleNamespace(audio=SimpleNamespace(transcriptions=transcriptions))
    monkeypatch.setattr(audio, "_openai_client", client)
    return transcriptions


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user=PARENT):
    return {"Authorization": f"Bearer {create_access_token(user['_id'], user['location'])}"}


def _upload(
    client, filename="note.webm", content=b"\x1a\x45\xdf\xa3audio", mime="audio/webm", **kw
):
    return client.post(URL, files={"audio": (filename, content, mime)}, **kw)


# -- access control --------------------------------------------------------------


def test_requires_a_token(users, openai, client):
    res = _upload(client)
    assert (res.status_code, res.json()["detail"]) == (401, "Not authenticated")


def test_admins_cannot_use_it(users, openai, client):
    res = _upload(client, headers=_auth(ADMIN))
    assert (res.status_code, res.json()["detail"]) == (403, "Not available for admin accounts")
    assert openai.calls == []


def test_rate_limited_before_the_user_lookup(users, openai, client):
    for _ in range(10):
        assert _upload(client, headers=_auth()).status_code == 200
    lookups = users.lookups
    assert _upload(client, headers=_auth()).status_code == 429
    assert users.lookups == lookups  # rejected before get_current_parent's DB query


def test_missing_file_is_422(users, openai, client):
    assert client.post(URL, headers=_auth()).status_code == 422


# -- happy path ------------------------------------------------------------------


def test_transcribes_with_whisper_in_english(users, openai, client):
    res = _upload(client, content=b"voice-bytes", headers=_auth())
    assert (res.status_code, res.json()) == (200, {"transcript": "hello world"})
    [call] = openai.calls
    assert call == {
        "model": "whisper-1",
        "name": "recording.webm",
        "bytes": b"voice-bytes",
        "mime": "audio/webm",
        "language": "en",
    }


@pytest.mark.parametrize(
    ("ext", "mime"),
    [
        ("webm", "audio/webm"),
        ("mp3", "audio/mpeg"),
        ("wav", "audio/wav"),
        ("m4a", "audio/mp4"),
        ("ogg", "audio/ogg"),
        ("mp4", "audio/mp4"),
    ],
)
def test_mime_type_comes_from_the_allowlist_not_the_client(users, openai, client, ext, mime):
    res = _upload(client, filename=f"clip.{ext}", mime="application/x-evil", headers=_auth())
    assert res.status_code == 200
    [call] = openai.calls
    # Fixed server-side name (never the user's filename) and the allowlisted MIME type.
    assert (call["name"], call["mime"]) == (f"recording.{ext}", mime)


@pytest.mark.parametrize(
    ("filename", "ext"),
    [
        ("VOICE.MP3", "mp3"),  # case-insensitive
        ("voice", "webm"),  # no extension → default
        ("archive.tar.ogg", "ogg"),  # last extension wins
        ("../../etc/passwd.wav", "wav"),  # path parts never reach OpenAI
    ],
)
def test_extension_parsing(users, openai, client, filename, ext):
    assert _upload(client, filename=filename, headers=_auth()).status_code == 200
    assert openai.calls[0]["name"] == f"recording.{ext}"


# -- rejected uploads -------------------------------------------------------------


@pytest.mark.parametrize("filename", ["malware.exe", "notes.txt", "clip.flac", "audio.webm.exe"])
def test_unsupported_extensions_are_415(users, openai, client, filename):
    res = _upload(client, filename=filename, headers=_auth())
    assert res.status_code == 415
    ext = filename.rsplit(".", 1)[-1]
    assert res.json()["detail"] == (
        f"Unsupported file type '.{ext}'. Allowed: m4a, mp3, mp4, ogg, wav, webm"
    )
    assert openai.calls == []


def test_the_last_extension_is_the_one_checked(users, openai, client):
    # "file.webm\x00.exe" can't pass as ".webm": the check uses the LAST extension.
    res = _upload(client, filename="file.webm\x00.exe", headers=_auth())
    assert res.status_code == 415
    assert "'.exe'" in res.json()["detail"]
    assert openai.calls == []


def test_over_http_del_is_stripped_and_encoded_controls_stay_encoded(users, openai, client):
    # Standard clients (browsers, httpx) percent-encode CR/LF/NUL/TAB in multipart
    # filenames and Starlette doesn't decode them, so only DEL arrives raw.
    assert _upload(client, filename="voice.og\x7fg", headers=_auth()).status_code == 200
    assert openai.calls[0]["name"] == "recording.ogg"
    res = _upload(client, filename="voice.mp3\r\n", headers=_auth())  # arrives as "mp3%0D%0A"
    assert res.status_code == 415
    assert "'.mp3%0d%0a'" in res.json()["detail"]


@pytest.mark.parametrize(
    ("filename", "ext"),
    [
        ("voice.mp3\r\n", "mp3"),  # raw CR/LF — only a hand-built multipart body carries these
        ("voice.m\x004a", "m4a"),  # raw NUL inside the extension
        ("voice.w\tav", "wav"),  # raw TAB
        ("voice.og\x7fg", "ogg"),  # DEL
    ],
)
def test_raw_control_bytes_are_stripped_before_reading_the_extension(openai, filename, ext):
    upload = UploadFile(file=io.BytesIO(b"voice"), filename=filename)
    assert asyncio.run(audio.transcribe_audio(SimpleNamespace(), settings, upload)) == {
        "transcript": "hello world"
    }
    assert openai.calls[0]["name"] == f"recording.{ext}"


def test_up_to_10_mb_is_accepted_and_one_byte_more_is_413(users, openai, client):
    assert _upload(client, content=b"a" * MAX_BYTES, headers=_auth()).status_code == 200
    assert len(openai.calls[0]["bytes"]) == MAX_BYTES
    res = _upload(client, content=b"a" * (MAX_BYTES + 1), headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (413, "Audio file too large (max 10 MB).")
    assert len(openai.calls) == 1  # the oversized file never reached OpenAI


@pytest.mark.parametrize("raw", [None, "\x00\x01"])
def test_missing_or_all_control_character_filename_defaults_to_webm(openai, monkeypatch, raw):
    # Multipart clients can't send a file without a filename, so call the handler directly.
    upload = UploadFile(file=io.BytesIO(b"voice"), filename=raw)
    result = asyncio.run(audio.transcribe_audio(SimpleNamespace(), settings, upload))
    assert result == {"transcript": "hello world"}
    assert openai.calls[0]["name"] == "recording.webm"


# -- failures ---------------------------------------------------------------------


def test_openai_failure_is_a_generic_502_with_the_error_logged(users, openai, client, caplog):
    openai.error = RuntimeError("upstream exploded: key sk-secret")
    with caplog.at_level(logging.WARNING, logger="app.routers.audio"):
        res = _upload(client, headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (
        502,
        "Transcription service is temporarily unavailable.",
    )
    assert "sk-secret" not in res.text  # never leaked to the client
    assert "audio.transcribe.error: upstream exploded" in caplog.text


@pytest.mark.parametrize(
    ("api_key", "init_error", "detail"),
    [
        ("", None, "OPENAI_API_KEY is not configured on this server."),
        ("sk-x", "bad base url", "Audio service failed to initialize. Check server logs."),
        ("sk-x", None, "OpenAI client is not available."),
    ],
)
def test_unavailable_client_is_503(users, client, monkeypatch, caplog, api_key, init_error, detail):
    monkeypatch.setattr(audio, "_openai_client", None)
    monkeypatch.setattr(audio, "_openai_init_error", init_error)
    monkeypatch.setattr(settings, "openai_api_key", api_key)
    with caplog.at_level(logging.ERROR, logger="app.routers.audio"):
        res = _upload(client, headers=_auth())
    assert (res.status_code, res.json()["detail"]) == (503, detail)
    if init_error:
        assert "bad base url" not in res.text  # detail stays generic…
        assert f"OpenAI client init error: {init_error}" in caplog.text  # …the log has it


def test_unavailable_client_is_checked_before_reading_the_upload(users, client, monkeypatch):
    monkeypatch.setattr(audio, "_openai_client", None)
    monkeypatch.setattr(settings, "openai_api_key", "")
    # Even an oversized, unsupported upload gets the 503 — nothing is processed.
    res = _upload(client, filename="x.exe", content=b"a" * (MAX_BYTES + 1), headers=_auth())
    assert res.status_code == 503
