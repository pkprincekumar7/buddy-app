import io
import logging
import re

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.deps import get_current_user
from app.limiter import user_limiter
from app.routers.llm import _openai_client, _openai_init_error
from app.settings import settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/audio", tags=["audio"])

_ALLOWED_AUDIO_EXTS = {"webm", "mp3", "wav", "m4a", "ogg", "mp4"}
_MIME_MAP = {
    "webm": "audio/webm",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "mp4": "audio/mp4",
}


class TranscribeResponse(BaseModel):
    transcript: str


@router.post(
    "/transcribe",
    response_model=TranscribeResponse,
    description="Transcribe an uploaded audio file to text using speech-to-text.",
)
@user_limiter.limit("10/minute")
async def transcribe_audio(
    request: Request,
    audio: UploadFile = File(...),
    user: dict = Depends(get_current_user),
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

    max_bytes = 10 * 1024 * 1024  # 10 MB
    # Read at most max_bytes + 1 bytes.  If we get back more than max_bytes the
    # file is too large; we reject it without buffering the rest of the upload.
    content = await audio.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail="Audio file too large (max 10 MB).")

    raw_name = audio.filename or "recording.webm"
    # Strip null bytes and control characters before parsing the extension so
    # a filename like "file.webm\x00.exe" cannot trick the allowlist check.
    filename = re.sub(r"[\x00-\x1f\x7f]", "", raw_name) or "recording.webm"
    raw_ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"
    if raw_ext not in _ALLOWED_AUDIO_EXTS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '.{raw_ext}'. Allowed: {', '.join(sorted(_ALLOWED_AUDIO_EXTS))}",
        )
    ext = raw_ext
    mime = _MIME_MAP[ext]  # use allowlisted value; ignores user-supplied Content-Type

    try:
        transcript = await _openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=(f"recording.{ext}", io.BytesIO(content), mime),
            language="en",
        )
        return {"transcript": transcript.text}
    except Exception as e:
        log.warning("audio.transcribe.error: %s", e)
        raise HTTPException(
            status_code=502, detail="Transcription service is temporarily unavailable."
        ) from e
