import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app import models
from app.database import get_db
from app.deps import get_current_parent
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
    user: dict = Depends(get_current_parent),
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
    # Collections that use child_id as _id (children, goals, goal_insights):
    #   inject _id = child_id so the filter hits the primary key index.
    # Collections that use a UUID _id with a separate child_id field
    #   (growth_areas, goal_months): inject child_id as a field filter.
    wb_dict = body.write_back.model_dump()
    collection = wb_dict["collection"]
    if collection in ("growth_areas", "goal_months"):
        child_scope = {"child_id": body.child_id}
    else:
        child_scope = {"_id": body.child_id}
    write_back = {
        **wb_dict,
        "filter": {
            **wb_dict["filter"],
            **child_scope,
            "user_id": user_id,        # always scope writes to the authenticated user
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

    # TODO(M10+): Replace the sequential count+insert below with a single atomic
    # transaction once the cluster is upgraded to Atlas M10 or higher. On M0/M2/M5
    # shared tiers, multi-document transactions are not supported and will raise
    # OperationFailure at runtime. The sequential approach has a small TOCTOU
    # window: two concurrent requests from the same user can both read
    # count < _MAX_IN_FLIGHT_PER_TYPE and both succeed, momentarily exceeding the
    # cap by one. This is acceptable for now (the cap is a soft guard, not a hard
    # billing limit) and will be closed when the transaction is added on M10+.
    #
    # On M10+, also add a startup probe in main.py to fail fast if transactions
    # are unavailable:
    #   async with await db.client.start_session() as s:
    #       async with s.start_transaction():
    #           pass
    try:
        existing = await db[models.JOBS].count_documents(
            {
                "location": user["location"],
                "user_id": user_id,
                "child_id": body.child_id,
                "type": body.type,
                "status": {"$in": ["pending", "processing", "result_ready"]},
            }
        )
        if existing >= _MAX_IN_FLIGHT_PER_TYPE:
            raise HTTPException(
                status_code=429,
                detail=f"Too many pending jobs for this child and type (max {_MAX_IN_FLIGHT_PER_TYPE})",
            )
        await db[models.JOBS].insert_one(doc)
    except HTTPException:
        raise
    except Exception as e:
        log.error("job.enqueue_failed job_id=%s error=%s", job_id, e, exc_info=True)
        raise HTTPException(
            status_code=503,
            detail="Job queue is temporarily unavailable.",
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
    user: dict = Depends(get_current_parent),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    # Field order matches the index (location, job_id, user_id) so the query
    # hits the index prefix and avoids a scatter-gather on a sharded cluster.
    doc = await db[models.JOBS].find_one({"location": user["location"], "job_id": job_id, "user_id": user["_id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobStatusResponse(
        job_id=doc["job_id"],
        status=doc["status"],
        error=doc.get("error"),
        created_at=doc["created_at"],
    )
