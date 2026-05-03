import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.deps import get_current_user
from app.models import User
from app.settings import settings

try:
    from openai import OpenAI
    _openai_client: OpenAI | None = OpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None
except Exception:
    _openai_client = None

router = APIRouter(prefix="/audio", tags=["audio"])


@router.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    if _openai_client is None:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not set on the server.",
        )

    content = await audio.read()

    # Fix #4: reject oversized uploads before hitting Whisper
    max_bytes = 10 * 1024 * 1024  # 10 MB
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail="Audio file too large (max 10 MB).")

    filename = audio.filename or "recording.webm"
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "webm"
    mime = audio.content_type or f"audio/{ext}"

    try:
        transcript = _openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=(f"recording.{ext}", io.BytesIO(content), mime),
            language="en",
        )
        return {"transcript": transcript.text}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
