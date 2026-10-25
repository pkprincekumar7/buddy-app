"""Valkey clients that sign in with an IAM token (docs/auth-users-split.md, 9.3; build plan 2.3).

In AWS each service connects to ElastiCache as its own RBAC user, `<app>-<env>-<service>`,
which only that service's task role may use (`elasticache:Connect`). There's no password:
the client presents a short-lived token instead, a SigV4-presigned
`GET https://<replication group>/?Action=connect&User=<user>` signed with the task role's
credentials (service `elasticache`, 15 minutes). redis-py asks its credential provider on
every new connection, so a token is made then, and reused for 10 minutes. ElastiCache drops
IAM connections after 12 hours; the client reconnects with a fresh token.

Locally (no REDIS_USERNAME), clients connect with the URL alone, as before.

    options = valkey_options(settings)          # {} locally
    cache = redis.asyncio.Redis.from_url(settings.redis_url, **options)
    limits = RateLimits(settings.redis_url, prefix=..., redis_options=options)
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

from redis.credentials import CredentialProvider

TOKEN_SECONDS = 900  # ElastiCache's maximum
REUSE_SECONDS = 600  # well inside it, so a connection never starts with a token about to lapse


class ElastiCacheIAMProvider(CredentialProvider):
    """`(user, token)` for redis-py; the token comes from the task role's credentials."""

    def __init__(
        self,
        user: str,
        replication_group_id: str,
        region: str,
        *,
        credentials: Any = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not user or not replication_group_id or not region:
            raise ValueError("an IAM Valkey user needs its user, replication group and region")
        self.user = user
        # Signed lower-case, as ElastiCache expects.
        self.replication_group_id = replication_group_id.lower()
        self.region = region
        self._credentials = credentials
        self.clock = clock
        self._lock = threading.Lock()
        self._token: str | None = None
        self._made_at = 0.0
        self._session: Any = None

    def _signer(self) -> Any:
        # botocore ships with boto3, which every deployed service already installs.
        import botocore.session
        from botocore.model import ServiceId
        from botocore.signers import RequestSigner

        # Kept on the provider: the signer holds its event emitter only weakly, so a session
        # that went out of scope could be collected mid-sign (ReferenceError).
        if self._session is None:
            self._session = botocore.session.get_session()
        session = self._session
        credentials = self._credentials or session.get_credentials()
        if credentials is None:
            raise RuntimeError("no AWS credentials for the Valkey IAM token (the task role)")
        return RequestSigner(
            ServiceId("elasticache"),
            self.region,
            "elasticache",
            "v4",
            credentials,
            session.get_component("event_emitter"),
        )

    def token(self) -> str:
        """A token for a new connection: the cached one, or a new one after 10 minutes."""
        with self._lock:
            token = self._token
            if token is None or self.clock() - self._made_at >= REUSE_SECONDS:
                url = self._signer().generate_presigned_url(
                    {
                        "method": "GET",
                        "url": f"https://{self.replication_group_id}/?Action=connect&User={self.user}",
                        "body": {},
                        "headers": {},
                        "context": {},
                    },
                    operation_name="connect",
                    expires_in=TOKEN_SECONDS,
                    region_name=self.region,
                )
                token = str(url).removeprefix("https://")
                self._token, self._made_at = token, self.clock()
            return token

    def get_credentials(self) -> tuple[str, str]:
        return self.user, self.token()


def valkey_options(settings: Any) -> dict[str, Any]:
    """Client options for `settings` (a ServiceSettings): the IAM provider when the service
    has an RBAC user (in AWS), nothing locally."""
    user = getattr(settings, "redis_username", None)
    if not user:
        return {}
    return {
        "credential_provider": ElastiCacheIAMProvider(
            user, settings.redis_replication_group_id or "", settings.aws_region
        )
    }
