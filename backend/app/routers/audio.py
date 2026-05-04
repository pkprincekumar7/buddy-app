import io
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.deps import get_current_user
from app.models import User
from app.settings import settings

log = logging.getLogger(__name__)

_openai_client = None
_openai_init_error: str | None = None

if not settings.openai_api_key:
    pass  # client stays None; endpoint will surface a clear 503
else:
    try:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    except Exception as _exc:
        _openai_init_error = str(_exc)
        log.warning("Failed to initialize OpenAI client: %s", _exc)

router = APIRouter(prefix="/audio", tags=["audio"])

_ALLOWED_AUDIO_EXTS = {"webm", "mp3", "wav", "m4a", "ogg", "mp4"}


class TranscribeResponse(BaseModel):
    transcript: str


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    if _openai_client is None:
        if not settings.openai_api_key:
            detail = "OPENAI_API_KEY is not configured on this server."
        elif _openai_init_error:
            log.error("OpenAI client init error: %s", _openai_init_error)
            detail = "Audio service failed to initialize. Check server logs."
        else:
            detail = "OpenAI client is not available."
        raise HTTPException(status_code=503, detail=detail)

    content = await audio.read()

    max_bytes = 10 * 1024 * 1024  # 10 MB
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail="Audio file too large (max 10 MB).")

    filename = audio.filename or "recording.webm"
    raw_ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"
    ext = raw_ext if raw_ext in _ALLOWED_AUDIO_EXTS else "webm"
    mime = audio.content_type or f"audio/{ext}"

    try:
        transcript = _openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=(f"recording.{ext}", io.BytesIO(content), mime),
            language="en",
        )
        return {"transcript": transcript.text}
    except Exception as e:
        log.warning("audio.transcribe.error: %s", e)
        raise HTTPException(status_code=502, detail="Transcription service is temporarily unavailable.") from e
