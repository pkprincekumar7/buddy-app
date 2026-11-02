"""Passwords and login backoff (production-readiness review, AUTH-04)."""

import asyncio
import threading
from typing import Any

import bcrypt
import pytest
from pydantic import ValidationError

from auth.app import tokens
from auth.app.main import RegisterBody
from auth.app.throttle import LoginThrottle

LONG = "Pa55-" + "x" * 95  # 100 bytes: bcrypt reads the first 72
KEY = "k" * 64


def test_a_long_password_hashed_before_still_matches():
    # What bcrypt 4.x stored for it so far: the whole password, silently cut at 72 bytes.
    stored = bcrypt.hashpw(LONG.encode(), bcrypt.gensalt(rounds=4)).decode()
    assert tokens.check_password(LONG, stored)
    assert tokens.check_password(LONG[:72], stored)  # the same 72 bytes
    assert not tokens.check_password(LONG[:71], stored)


def test_the_cut_does_not_depend_on_the_bcrypt_version(monkeypatch):
    # bcrypt 5.x raises past 72 bytes instead of cutting: hashing and checking still work.
    real_hash, real_check = bcrypt.hashpw, bcrypt.checkpw

    def strict(fn: Any) -> Any:
        def call(password: bytes, *args: Any) -> Any:
            if len(password) > 72:
                raise ValueError("password cannot be longer than 72 bytes")
            return fn(password, *args)

        return call

    monkeypatch.setattr(tokens, "BCRYPT_COST", 4)
    monkeypatch.setattr(bcrypt, "hashpw", strict(real_hash))
    monkeypatch.setattr(bcrypt, "checkpw", strict(real_check))
    hashed = tokens.hash_password(LONG)
    assert tokens.check_password(LONG, hashed)
    assert tokens.check_password(LONG + "anything after byte 72", hashed)


def test_the_cut_is_on_bytes_not_characters():
    # "é" is 2 bytes: 36 of them fill the 72, the 37th isn't read.
    assert len(tokens._bcrypt_input("é" * 40)) == 72
    assert tokens._bcrypt_input("é" * 36) == tokens._bcrypt_input("é" * 37)


def test_bcrypt_runs_on_its_own_threads(monkeypatch):
    monkeypatch.setattr(tokens, "BCRYPT_COST", 4)
    seen: list[str] = []
    real = tokens.check_password

    def spy(password: str, hashed: str) -> bool:
        seen.append(threading.current_thread().name)
        return real(password, hashed)

    monkeypatch.setattr(tokens, "check_password", spy)

    async def main() -> bool:
        hashed = await tokens.async_hash_password("abc12345")
        return await tokens.async_check_password("abc12345", hashed)

    assert asyncio.run(main())
    assert seen and all(name.startswith("bcrypt") for name in seen)  # not the default pool


REGISTER = {"email": "a@example.com", "first_name": "A", "country_code": "IN"}


def test_registration_refuses_a_password_bcrypt_would_cut():
    RegisterBody.model_validate({**REGISTER, "password": "a1" + "x" * 70})  # 72 bytes: fine
    with pytest.raises(ValidationError, match="at most 72 characters"):
        RegisterBody.model_validate({**REGISTER, "password": "a1" + "x" * 71})
    with pytest.raises(ValidationError, match="fewer with accents"):
        RegisterBody.model_validate({**REGISTER, "password": "a1" + "é" * 36})  # 74 bytes


def test_failures_from_many_ips_slow_the_account_to_one_attempt_a_minute():
    """20 failed logins for one email from 20 IPs: after 10, one attempt a minute."""

    async def main() -> list[bool]:
        throttle = LoginThrottle(None)
        blocked = []
        for n in range(20):
            ip = f"198.51.100.{n}"
            is_blocked = await throttle.is_blocked(KEY, ip)
            blocked.append(is_blocked)
            if not is_blocked:
                await throttle.failed(KEY, ip)
        return blocked

    blocked = asyncio.run(main())
    # Each IP is new, so only the account count matters: 10 tries, then this minute's one.
    assert blocked[:11] == [False] * 11
    assert blocked[11:] == [True] * 9


def test_a_correct_password_clears_the_account_count():
    async def main() -> tuple[bool, bool]:
        throttle = LoginThrottle(None)
        for n in range(10):
            await throttle.failed(KEY, f"203.0.113.{n}")
        assert not await throttle.is_blocked(KEY, "203.0.113.50")  # this minute's attempt
        slowed = await throttle.is_blocked(KEY, "203.0.113.51")
        await throttle.succeeded(KEY, "203.0.113.50")
        return slowed, await throttle.is_blocked(KEY, "203.0.113.52")

    slowed, after_success = asyncio.run(main())
    assert slowed and not after_success
