"""
Background reconciler for stalled two-phase saga writes and housekeeping.

Registration and Google sign-up use a three-phase saga:
  Phase 1 — write UserRegionRecord(status='pending') to the router DB.
  Phase 2 — create User row in the regional DB.
  Phase 3 — update UserRegionRecord(status='active') in the router DB.

If the process crashes or the router DB is briefly unavailable between
phases, the record stays 'pending'.  This job repairs those rows:
  • status='pending' + User row EXISTS  → Phase 3 failed; mark 'active'.
  • status='pending' + User row MISSING → Phase 2 failed; delete the router
    record so the email address can be re-registered.

Also runs cleanup_expired_tokens() to prevent unbounded growth of the
refresh_tokens table.

Distributed lock: when Redis is available, a SET NX EX lock prevents
concurrent runs across pods.  Without Redis the lock is skipped — every pod
will run the job (safe, just redundant work).
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

log = logging.getLogger(__name__)

_LOCK_KEY = "reconciler_lock"
_STALE_MINUTES = 10

# Module-level sync Redis client, initialised once on first run.
_redis_client = None
_redis_init_done = False


def _get_redis():
    global _redis_client, _redis_init_done
    if _redis_init_done:
        return _redis_client
    _redis_init_done = True
    from app.settings import settings
    if not settings.redis_url:
        return None
    try:
        import redis as _redis_mod
        _redis_client = _redis_mod.from_url(
            settings.redis_url,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )
        return _redis_client
    except Exception as exc:
        log.warning("reconciler: Redis init failed — running without distributed lock: %s", exc)
        return None


def reconcile_pending_routes() -> None:
    """
    Repair stale 'pending' UserRegionRecord rows.

    Scheduled by APScheduler every RECONCILER_INTERVAL_MINUTES minutes.
    Each run is guarded by a Redis distributed lock so only one pod operates
    at a time in a multi-instance deployment.
    """
    from app.database import _make_session, _router_engine, db_for_region
    from app.models import UserRegionRecord, User
    from app.settings import settings

    redis = _get_redis()
    lock_ttl = max(settings.reconciler_interval_minutes * 60 - 10, 30)
    lock_held = False

    if redis is not None:
        try:
            lock_held = bool(redis.set(_LOCK_KEY, "1", nx=True, ex=lock_ttl))
            if not lock_held:
                log.debug("reconciler: lock held by another pod, skipping run")
                return
        except Exception as exc:
            log.warning("reconciler: Redis lock unavailable, proceeding without it: %s", exc)
            lock_held = False

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=_STALE_MINUTES)
    router_db = _make_session(_router_engine())
    activated = deleted = errors = 0

    try:
        pending = router_db.execute(
            select(UserRegionRecord).where(
                UserRegionRecord.status == "pending",
                UserRegionRecord.created_at < cutoff,
            )
        ).scalars().all()

        for record in pending:
            try:
                with db_for_region(record.region) as regional_db:
                    user_exists = regional_db.get(User, record.user_id) is not None

                if user_exists:
                    record.status = "active"
                    router_db.commit()
                    activated += 1
                    log.info(
                        "reconciler: activated email_hash=%s user_id=%s region=%s",
                        record.email_hash, record.user_id, record.region,
                    )
                else:
                    router_db.delete(record)
                    router_db.commit()
                    deleted += 1
                    log.info(
                        "reconciler: removed orphan email_hash=%s user_id=%s region=%s",
                        record.email_hash, record.user_id, record.region,
                    )
            except Exception as exc:
                router_db.rollback()
                errors += 1
                log.error(
                    "reconciler: error processing email_hash=%s: %s",
                    record.email_hash, exc, exc_info=True,
                )

        if activated or deleted or errors:
            log.info(
                "reconciler: run complete activated=%d deleted=%d errors=%d",
                activated, deleted, errors,
            )

    except Exception as exc:
        log.error("reconciler: fatal error: %s", exc, exc_info=True)
    finally:
        router_db.close()
        if redis is not None and lock_held:
            try:
                redis.delete(_LOCK_KEY)
            except Exception:
                pass


def cleanup_expired_tokens() -> None:
    """
    Delete expired refresh_tokens rows from every configured regional DB.

    Rows are considered safe to delete once their expiry has passed plus a
    1-day grace period (in case of clock skew or a delayed reconciler run).

    In single-instance mode only the main engine is cleaned.  In multi-region
    mode every regional DB URL is visited so no region is skipped.

    This job is safe to run concurrently across pods — DELETE WHERE is
    idempotent and each pod touches independent rows.
    """
    from app.database import _make_session, _regional_engine, engine as _main_engine
    from app.models import RefreshToken
    from app.settings import settings

    cutoff = datetime.now(timezone.utc) - timedelta(days=1)

    # Build the set of engines to clean: main + all regional (deduplicated by id).
    engines_to_clean: dict[int, object] = {id(_main_engine): _main_engine}
    for region in settings.regional_db_urls:
        eng = _regional_engine(region)
        engines_to_clean[id(eng)] = eng

    total_deleted = 0
    for eng in engines_to_clean.values():
        db = _make_session(eng)
        try:
            result = db.execute(
                delete(RefreshToken).where(RefreshToken.expires_at < cutoff)
            )
            db.commit()
            total_deleted += result.rowcount
        except Exception as exc:
            db.rollback()
            log.error("cleanup_expired_tokens: error on engine %s: %s", eng, exc, exc_info=True)
        finally:
            db.close()

    if total_deleted:
        log.info("cleanup_expired_tokens: deleted %d expired rows", total_deleted)
