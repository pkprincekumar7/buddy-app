"""auth's side of the authz cache (docs/auth-users-split.md, 9.3).

`authz:{user_id}` holds what every service checks on every request. Every write goes
through one Lua script that accepts only a **strictly higher** `ver` (the account's
`authz_version`), or the same `ver` with identical content, so a slow write that read the
account just before an admin locked it can't overwrite the newer, locked entry. Entries
live 1 h; the change stream (build plan 3.3) keeps them current in between.

A cache that can't be reached is never an error here: the next request misses and fills
from auth (fail closed only if auth can't answer either).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

from redis.exceptions import RedisError

from common.authz import CACHE_PREFIX, AuthzEntry

TTL_SECONDS = 3600

_logger = logging.getLogger(__name__)

# KEYS[1] = authz:{user_id}; ARGV = entry JSON, its ver, TTL, and "1" to write only over an
# existing entry (the change stream's mode). Returns 1 if written.
VERSIONED_WRITE = """
local current = redis.call('GET', KEYS[1])
if not current and ARGV[4] == '1' then return 0 end
if current then
  local ok, stored = pcall(cjson.decode, current)
  if ok and type(stored) == 'table' and tonumber(stored['ver']) then
    local stored_ver, new_ver = tonumber(stored['ver']), tonumber(ARGV[2])
    if stored_ver > new_ver then return 0 end
    if stored_ver == new_ver and current ~= ARGV[1] then return 0 end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
return 1
"""


def entry_from_account(doc: Mapping[str, Any]) -> AuthzEntry:
    """The cache entry for an `auth.auth` document."""
    revoked = doc.get("tokens_revoked_at")
    return AuthzEntry(
        ver=int(doc["authz_version"]),
        role=str(doc["role"]),
        locked=bool(doc.get("is_locked", False)),
        deleting=bool(doc.get("is_being_deleted", False)),
        revoked_at_ms=int(revoked.timestamp() * 1000) if revoked is not None else None,
    )


def entry_json(entry: AuthzEntry) -> str:
    """Canonical JSON, so "the same ver with identical content" compares byte for byte."""
    return json.dumps(
        {
            "ver": entry.ver,
            "role": entry.role,
            "locked": entry.locked,
            "deleting": entry.deleting,
            "revoked_at_ms": entry.revoked_at_ms,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


async def write_entry(
    cache: Any, user_id: str, entry: AuthzEntry, *, only_existing: bool = False
) -> bool:
    """The versioned write. True if stored; False if a newer entry won, or no cache.

    `only_existing`: update the entry only if this region already holds one, so the change
    stream (which sees every account) doesn't fill a region with every user (9.3).
    """
    if cache is None:
        return False
    try:
        written = await cache.eval(
            VERSIONED_WRITE,
            1,
            CACHE_PREFIX + user_id,
            entry_json(entry),
            entry.ver,
            TTL_SECONDS,
            "1" if only_existing else "0",
        )
    except (RedisError, OSError, TimeoutError):
        _logger.warning("authz cache unreachable; %s fills on its next request", user_id)
        return False
    return bool(written)


async def delete_entry(cache: Any, user_id: str) -> None:
    """An account that no longer exists: drop its entry (the next request fills a 401)."""
    if cache is None:
        return
    try:
        await cache.delete(CACHE_PREFIX + user_id)
    except (RedisError, OSError, TimeoutError):
        _logger.warning("authz cache unreachable; %s's entry expires on its own", user_id)
