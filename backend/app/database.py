"""
Database engine management with transparent multi-region routing.

Single-instance mode (default)
    All helper functions (get_db, get_router_db) and the context manager
    (db_for_region) return sessions bound to the single main engine.
    No env-var changes are needed; the app works exactly as before.

Multi-region mode (activated by env vars)
    Set any combination of:
        ROUTER_DB_URL      — dedicated router PostgreSQL instance
        REGIONAL_DB_URLS   — JSON map of {"eu": "postgresql://...", ...}

    When set, each helper routes to the appropriate engine.  The main engine
    (DATABASE_URL) acts as the fallback for any unmapped region.

Region extraction
    get_db reads the `region` claim from the access_token cookie without full
    JWT verification (the claim is not security-sensitive — actual auth is
    always performed by get_current_user).  This keeps all existing route
    signatures untouched; FastAPI injects Request automatically.
"""

import logging
import threading
from contextlib import contextmanager
from typing import Generator

import jwt
from fastapi import Request
from sqlalchemy import create_engine, Engine
from sqlalchemy.orm import sessionmaker, Session, DeclarativeBase

from app.routing import REGION_RE
from app.settings import settings

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# ORM base
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Engine factory
# ---------------------------------------------------------------------------

def _build_engine(url: str) -> Engine:
    is_sqlite = url.startswith("sqlite")
    pg_kwargs: dict = (
        {}
        if is_sqlite
        else {
            "pool_size": settings.postgres_pool_size,
            "max_overflow": settings.postgres_max_overflow,
            # Recycle connections every hour so Aurora / RDS doesn't silently
            # drop idle connections at its TCP keepalive timeout.
            "pool_recycle": 3600,
        }
    )
    return create_engine(
        url,
        connect_args={"check_same_thread": False} if is_sqlite else {},
        pool_pre_ping=not is_sqlite,
        **pg_kwargs,
    )


# Main (default) engine — always present
_sqlite = settings.database_url.startswith("sqlite")
engine = _build_engine(settings.database_url)

# Cache of additional engines keyed by DB URL string
_extra_engines: dict[str, Engine] = {}
_engine_lock = threading.Lock()


def _cached_engine(url: str) -> Engine:
    """Return a cached engine for `url`, creating it on first call."""
    with _engine_lock:
        if url not in _extra_engines:
            _extra_engines[url] = _build_engine(url)
        return _extra_engines[url]


# ---------------------------------------------------------------------------
# Per-purpose engine selectors (all fall back to main engine)
# ---------------------------------------------------------------------------

def _regional_engine(region: str) -> Engine:
    """Engine for a specific region. Falls back to main engine if not configured."""
    url = settings.regional_db_urls.get(region)
    if url:
        return _cached_engine(url)
    # In multi-region mode, an unrecognised region value is a routing gap worth
    # knowing about.  In single-instance mode regional_db_urls is empty so this
    # fires only when the map is non-empty but the claim has no entry.
    if settings.regional_db_urls:
        log.debug(
            "No DB URL configured for region %r — falling back to main engine", region
        )
    return engine


def _router_engine() -> Engine:
    """Engine for the Global Router DB. Falls back to main engine."""
    return _cached_engine(settings.router_db_url) if settings.router_db_url else engine




# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

# One sessionmaker per engine — created once, reused on every request.
#
# Keyed by id(eng) rather than str(eng.url) for two reasons:
#   1. SQLAlchemy's URL.__str__ obscures the password with "***", so two
#      engines that differ only in credentials would share the same string
#      key and collide in this cache.
#   2. id(eng) is a plain int — cheaper to hash and compare than a URL string.
#
# Safety: id() is only stable while the object is alive.  All engines this
# module creates are either the module-level `engine` or entries in
# `_extra_engines`, both of which live for the process lifetime, so id(eng)
# will never be reused by a different engine object.
_session_factories: dict[int, sessionmaker] = {}
_factory_lock = threading.Lock()


def _make_session(eng: Engine) -> Session:
    """Return a new session from the cached factory for `eng`.

    The factory is keyed by id(eng) (see comment on _session_factories above).

    Double-checked locking: the outer check avoids acquiring the lock on
    every request once the factory is cached (the common path).  The inner
    check inside the lock prevents a duplicate insert when two threads both
    pass the outer check simultaneously on first use.

    The engine's dialect name is stored in session.info["dialect"] so that
    get_upsert_insert(db) can return the right INSERT construct without
    relying on the deprecated Session.bind / Session.get_bind() APIs.
    """
    engine_id = id(eng)
    if engine_id not in _session_factories:
        with _factory_lock:
            if engine_id not in _session_factories:
                _session_factories[engine_id] = sessionmaker(
                    autocommit=False, autoflush=False, bind=eng
                )
    sess = _session_factories[engine_id]()
    sess.info["dialect"] = eng.dialect.name
    return sess


# ---------------------------------------------------------------------------
# Region extraction from request cookie (no-verify read of JWT payload)
# ---------------------------------------------------------------------------

# Sentinel used to distinguish "not yet computed" from any real region string
# stored in request.state (including settings.default_region).
_REGION_UNSET = object()


def _region_from_request(request: Request | None) -> str:
    """
    Extract the `region` claim from the access_token cookie.

    The signature IS verified (prevents a crafted cookie from routing an
    authenticated request to an arbitrary region's DB).  Expiry is NOT
    verified so that the refresh endpoint can still route correctly when the
    access token is legitimately expired.  The actual authentication check
    (including expiry) is always performed separately by get_current_user.

    The extracted region is validated against REGION_RE (routing.py) before use so that
    a crafted JWT cannot inject arbitrary strings into log output or routing
    logic (log-injection defence).

    Result is cached in request.state._db_region so that routes with multiple
    Depends(get_db) / Depends(get_router_db) injections only pay the JWT
    signature-verification cost once per request.

    Returns settings.default_region if request is None, the cookie is absent,
    the signature is invalid, the token is otherwise malformed, or the region
    claim fails the allowlist pattern check.
    """
    if request is None:
        return settings.default_region

    # Return the cached result from an earlier call in the same request lifecycle.
    cached = getattr(request.state, "_db_region", _REGION_UNSET)
    if cached is not _REGION_UNSET:
        return cached  # type: ignore[return-value]

    token = request.cookies.get("access_token")
    if not token:
        request.state._db_region = settings.default_region
        return settings.default_region
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"verify_exp": False},   # signature verified; expiry is not
        )
    except jwt.PyJWTError:
        request.state._db_region = settings.default_region
        return settings.default_region

    if payload.get("type") != "access":
        # Reject refresh tokens or any other token type placed in the access_token slot.
        request.state._db_region = settings.default_region
        return settings.default_region

    region = payload.get("region")
    if not region or not isinstance(region, str) or not REGION_RE.match(region):
        # Claim absent, wrong type, or contains characters outside the safe
        # allowlist — fall back silently rather than routing to an unexpected DB.
        request.state._db_region = settings.default_region
        return settings.default_region

    request.state._db_region = region
    return region


# ---------------------------------------------------------------------------
# FastAPI dependency: get_db
# ---------------------------------------------------------------------------

def get_db(request: Request) -> Generator:
    """
    Region-aware database session dependency.

    FastAPI injects Request automatically when used with Depends() in a route —
    no route signature changes needed.  In single-instance mode all regions map
    to the main engine, so behaviour is identical to the original get_db.

    FastAPI injects Request automatically when used with Depends() in a route.
    Outside FastAPI (scripts, tests, management commands) use db_for_region,
    which is a proper context manager and correctly runs rollback/close on exit:

        # FastAPI route (automatic injection)
        db: Session = Depends(get_db)

        # Outside FastAPI
        with db_for_region(settings.default_region) as db:
            ...
    """
    region = _region_from_request(request)
    db = _make_session(_regional_engine(region))
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# FastAPI dependency: get_router_db
# ---------------------------------------------------------------------------

def get_router_db() -> Generator:
    """
    Session for the Global Router DB (email_hash → region).
    Falls back to the main DB in single-instance mode.
    Used by register, login, and delete_account routes.

    Single-instance note: routes that inject both get_db and get_router_db
    (e.g. register, delete_account) will open two sessions to the same engine
    when no ROUTER_DB_URL is configured.  The overhead is one extra connection
    checkout per request, which is acceptable given the low call frequency of
    those endpoints.
    """
    db = _make_session(_router_engine())
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Context manager: db_for_region
# ---------------------------------------------------------------------------

@contextmanager
def db_for_region(region: str) -> Generator:
    """
    Explicit regional session for use outside FastAPI dependency injection
    (e.g. inside register/login route bodies where no JWT exists yet).

    Usage:
        with db_for_region(region) as db:
            db.add(user)
            db.commit()
    """
    db = _make_session(_regional_engine(region))
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Dialect-aware upsert helper (unchanged interface)
# ---------------------------------------------------------------------------

def get_upsert_insert(session: "Session | None" = None):
    """Return the dialect-appropriate INSERT construct for upserts.

    Pass the current Session to resolve the dialect from the actual engine
    the session is bound to (stored in session.info["dialect"] by _make_session).
    This is necessary in multi-region mode where the main database_url may be
    a different dialect than the regional DB the session is using.

    Falls back to the module-level _sqlite flag (main engine dialect) when no
    session is supplied — e.g. at import time or outside FastAPI.
    """
    use_sqlite = _sqlite
    if session is not None:
        dialect = session.info.get("dialect")
        if dialect is not None:
            use_sqlite = dialect == "sqlite"
    if use_sqlite:
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert
    return insert
