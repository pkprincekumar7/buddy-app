import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app import models
from app.database import get_db
from app.deps import get_current_user
from app.limiter import user_limiter
from app.models_api import EnqueueJobRequest, EnqueueJobResponse, JobStatusResponse

router = APIRouter(prefix="/jobs", tags=["jobs"])
log = logging.getLogger(__name__)

_MAX_IN_FLIGHT_PER_TYPE = 2


def _sanitize_for_log(value: object) -> str:
    return str(value).replace("\r", "").replace("\n", "")


@router.post(
    "",
    response_model=EnqueueJobResponse,
    status_code=201,
    description=(
        "Enqueue an LLM job. Returns a job_id immediately — the worker processes the job "
        "asynchronously. Poll GET /jobs/{job_id} for completion."
    ),
)
@user_limiter.limit("30/minute")
async def enqueue_job(
    request: Request,
    body: EnqueueJobRequest,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    user_id = user["_id"]

    # Auth guard — child must belong to this user
    child = await db[models.CHILDREN].find_one(
        {"_id": body.child_id, "user_id": user_id, "location": user["location"]}
    )
    if not child:
        raise HTTPException(status_code=404, detail="Child not found")

    now = datetime.now(UTC)
    job_id = str(uuid.uuid4())

    # Scope the domain write to the exact child being operated on.
    # `children` and `goals` use child_id as _id, so inject _id directly.
    # `growth_areas` uses a UUID _id and a separate child_id field — inject
    # child_id as a field instead so update_one matches the right document.
    wb_dict = body.write_back.model_dump()
    collection = wb_dict["collection"]
    if collection == "growth_areas":
        child_scope = {"child_id": body.child_id}
    else:
        child_scope = {"_id": body.child_id}
    write_back = {
        **wb_dict,
        "filter": {
            **wb_dict["filter"],
            **child_scope,
            "location": user["location"],  # overwrite any client-supplied location
        },
    }

    doc = {
        "job_id": job_id,
        "user_id": user_id,
        "child_id": body.child_id,
        "location": user["location"],
        "type": body.type,
        "payload": {
            "prompt": body.payload.prompt,
            "response_json_schema": body.payload.response_json_schema,
            "provider": body.payload.provider,
        },
        "write_back": write_back,
        "status": "pending",
        "result": None,
        "error": None,
        "llm_attempt": 0,
        "domain_write_attempt": 0,
        "max_llm_attempts": 3,
        "max_domain_attempts": 5,
        # retry_after = now so the job is immediately claimable.
        # The worker updates this field on each LLM backoff retry.
        "retry_after": now,
        "created_at": now,
        "updated_at": now,
        "claimed_at": None,
        "completed_at": None,
    }

    # Use a transaction to atomically check the in-flight cap and insert the job.
    # Without a transaction, two concurrent requests from the same user can both
    # read count < _MAX_IN_FLIGHT_PER_TYPE and both insert, exceeding the cap.
    #
    # IMPORTANT: Multi-document transactions require a MongoDB replica set or
    # sharded cluster (Atlas M10+). They are not available on Atlas M0/M2/M5
    # shared tiers. If this service is deployed on a shared tier, the transaction
    # will raise OperationFailure and enqueue_job will return 503.
    #
    # To catch this early rather than at request time, add a startup check in
    # main.py (similar to the worker's MongoDB ping) that tests transaction
    # support:
    #   async with await db.client.start_session() as s:
    #       async with s.start_transaction():
    #           pass  # raises OperationFailure on M0/M2/M5, fails fast at boot
    try:
        async with await db.client.start_session() as session, session.start_transaction():
            existing = await db[models.JOBS].count_documents(
                {
                    "user_id": user_id,
                    "child_id": body.child_id,
                    "type": body.type,
                    "status": {"$in": ["pending", "processing", "result_ready"]},
                },
                session=session,
            )
            if existing >= _MAX_IN_FLIGHT_PER_TYPE:
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many pending jobs for this child and type (max {_MAX_IN_FLIGHT_PER_TYPE})",
                )
            await db[models.JOBS].insert_one(doc, session=session)
    except HTTPException:
        raise
    except Exception as e:
        log.error("job.enqueue_failed job_id=%s error=%s", job_id, e, exc_info=True)
        raise HTTPException(
            status_code=503,
            detail="Job queue is temporarily unavailable. Ensure the database supports transactions (Atlas M10+).",
        ) from e

    # Record job_id in children.active_jobs so every device can resume polling.
    # Non-fatal: if this write fails, the job still runs and completes; the only
    # downside is that cross-device resume won't work for this specific job.
    try:
        await db[models.CHILDREN].update_one(
            {"_id": body.child_id, "location": user["location"]},
            {"$set": {f"active_jobs.{body.type}": job_id, "updated_at": now}},
        )
    except Exception:
        log.warning(
            "job.active_jobs_update_failed job_id=%s child_id=%s — job will still be processed",
            job_id,
            _sanitize_for_log(body.child_id),
            exc_info=True,
        )

    safe_type = _sanitize_for_log(body.type)
    safe_child_id = _sanitize_for_log(body.child_id)
    log.info("job.enqueued job_id=%s type=%s child_id=%s", job_id, safe_type, safe_child_id)
    return EnqueueJobResponse(job_id=job_id)


@router.get(
    "/{job_id}",
    response_model=JobStatusResponse,
    description=(
        "Poll the status of a previously enqueued job. "
        "Re-fetch domain data when status == 'completed'."
    ),
)
@user_limiter.limit("60/minute")
async def get_job_status(
    request: Request,
    job_id: str = Path(..., min_length=1, max_length=100),
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    doc = await db[models.JOBS].find_one({"job_id": job_id, "user_id": user["_id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobStatusResponse(
        job_id=doc["job_id"],
        status=doc["status"],
        error=doc.get("error"),
        created_at=doc["created_at"],
    )
