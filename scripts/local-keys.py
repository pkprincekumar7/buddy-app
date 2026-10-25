#!/usr/bin/env python3
"""The local stack's keys, made once into a Docker volume (docker-compose.yml, `local-keys`).

In AWS, Terraform makes each service's service-token key and publishes the public keys
(infra-live-backend/terraform/service_tokens.tf); locally this does the same, so internal
calls (auth → users at registration, the circles → children) are signed and verified as
deployed. Into KEYS_DIR (the `local_keys` volume, never the repository or `.env`):

- `<service>.pem`: each service's Ed25519 private key, made on the first run only, so a
  restart keeps them;
- `internal_public_keys.json`: `{service: {kid: PEM}}`, every service's INTERNAL_PUBLIC_KEYS;
- `jwt_public_keys.json`: `{JWT_KEY_ID: PEM}`, the public half of JWT_PRIVATE_KEY (from
  `.env`), every service's JWT_PUBLIC_KEYS, so the tokens auth issues verify everywhere.

Each service reads its own files at start-up (its compose `command`). Runs as root, then
gives the files to `appuser`, the user the services run as. Needs only `cryptography`,
which every service image has.
"""

from __future__ import annotations

import json
import os
import pwd
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives.serialization import load_pem_private_key

SERVICES = ("auth", "users", "children")


def kid(service: str) -> str:
    return f"{service}-local"


def _public_pem(private: object) -> str:
    public = private.public_key()  # type: ignore[attr-defined]
    return str(
        public.public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode()
    )


def make(
    keys_dir: Path,
    jwt_private_key: str,
    jwt_key_id: str,
    services: tuple[str, ...] = SERVICES,
) -> None:
    keys_dir.mkdir(parents=True, exist_ok=True)
    public: dict[str, dict[str, str]] = {}
    for service in services:
        path = keys_dir / f"{service}.pem"
        if not path.exists():
            key = ed25519.Ed25519PrivateKey.generate()
            path.write_bytes(
                key.private_bytes(
                    serialization.Encoding.PEM,
                    serialization.PrivateFormat.PKCS8,
                    serialization.NoEncryption(),
                )
            )
        private = load_pem_private_key(path.read_bytes(), password=None)
        public[service] = {kid(service): _public_pem(private)}
    (keys_dir / "internal_public_keys.json").write_text(json.dumps(public))

    jwt_key = load_pem_private_key(
        jwt_private_key.replace("\\n", "\n").encode(), password=None
    )
    (keys_dir / "jwt_public_keys.json").write_text(
        json.dumps({jwt_key_id: _public_pem(jwt_key)})
    )


def hand_over(keys_dir: Path, user: str = "appuser") -> None:
    """The services run as `appuser`: give it the files, readable by it alone."""
    entry = pwd.getpwnam(user)
    os.chown(keys_dir, entry.pw_uid, entry.pw_gid)
    for path in keys_dir.iterdir():
        os.chown(path, entry.pw_uid, entry.pw_gid)
        path.chmod(0o600)


def main() -> int:
    jwt_private_key = os.environ.get("JWT_PRIVATE_KEY", "")
    if not jwt_private_key:
        print(
            "local-keys: JWT_PRIVATE_KEY is required (see .env.example)",
            file=sys.stderr,
        )
        return 1
    keys_dir = Path(os.environ.get("KEYS_DIR", "/keys"))
    make(keys_dir, jwt_private_key, os.environ.get("JWT_KEY_ID", "key-v1"))
    if os.geteuid() == 0:
        hand_over(keys_dir)
    print(f"local-keys: keys ready for {', '.join(SERVICES)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
