#!/usr/bin/env python3
"""Every endpoint of the split services, through the gateway, on the local stack.

Run with the backend venv against the compose `split` stack (docs/getting-started.md):

    backend/.venv/bin/python scripts/e2e/full-journey.py

journey.py walks one child from profile to Connect; this walks the rest on top of it, so a
run touches every public route (except Google sign-in, which needs Google):

- **Account (auth, users):** login, `me`, refresh (as the mobile app does, with the refresh
  token), logout-all (the old tokens stop working), the profile and preferences.
- **Children:** the list and a change to the child.
- **Every kind of generation:** grow's questions, child rounds and recommendations (the area
  then completed with the child's picks); transform's plan, event tracker and Life Pathway;
  release's observations, regenerated after the first watch.
- **Shared:** the build's health, speech-to-text (a one-second tone, a real transcription
  call) and the APK link (a test APK put in the local assets bucket, then removed).
- **Admin:** a second account made admin (stack.local_admin) lists and finds accounts,
  reads the parent's children and a circle with the owner's `?location=`, locks and
  unlocks the parent, and promotes and demotes a third account. The admin is undone and
  both extra accounts deleted at the end.

The generations use the LLM keys in .env: about ten provider calls and one transcription.
Each account's password is generated and never printed. Exit code 0 when everything passed.
"""

from __future__ import annotations

import io
import math
import struct
import sys
import uuid
import wave
from typing import Any

import boto3
import httpx
import journey
from journey import Journey
from stack import (
    API,
    GATEWAY,
    MOTO_URL,
    REGION,
    WalkFailed,
    auth_gone,
    check,
    local_admin,
    new_password,
    poll,
    register,
    seed_email,
    step,
)

ASSETS_BUCKET = "person-local-assets-bucket"
APK_PREFIX = "app-assets/applications/android/"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _login(email: str, password: str, *, expect: int = 200) -> dict[str, Any]:
    response = httpx.post(
        f"{API}/auth/login", json={"email": email, "password": password}
    )
    return check(response, expect)  # type: ignore[no-any-return]


def _signed_in(j: Journey) -> None:
    """A fresh session for the journey's client, after its tokens were revoked."""
    tokens = _login(j.email, j.password)
    j.http.headers["Authorization"] = f"Bearer {tokens['access_token']}"


# ── the account ────────────────────────────────────────────────────────────────


def account(j: Journey) -> None:
    step("auth: login, me, refresh, logout-all")
    tokens = _login(j.email, j.password)
    me = check(
        httpx.get(f"{API}/auth/me", headers=_bearer(tokens["access_token"])), 200
    )
    if me.get("id", me.get("user_id")) != j.user_id:
        raise WalkFailed(f"me is someone else: {me}")
    # The mobile app refreshes with the refresh token as a bearer token.
    refreshed = check(
        httpx.post(f"{API}/auth/refresh", headers=_bearer(tokens["refresh_token"])), 200
    )
    check(httpx.get(f"{API}/auth/me", headers=_bearer(refreshed["access_token"])), 200)
    check(
        httpx.post(
            f"{API}/auth/logout-all", headers=_bearer(refreshed["access_token"])
        ),
        200,
        204,
    )
    # Every token issued before it stops working, the journey's own included.
    check(httpx.get(f"{API}/auth/me", headers=_bearer(refreshed["access_token"])), 401)
    check(j.http.get(f"{API}/auth/me"), 401)
    _signed_in(j)

    step("users: the profile and preferences")
    profile = f"{API}/users/me/profile"
    check(j.http.get(profile), 200)
    changed = check(j.http.patch(profile, json={"last_name": "Tester"}), 200)
    if changed.get("last_name") != "Tester":
        raise WalkFailed(f"the profile change didn't stick: {changed}")
    check(j.http.patch(f"{API}/users/me/preferences", json={"tts_enabled": True}), 200)
    check(j.http.get(f"{API}/users/me/preferences"), 200)


# ── the circles, every kind of generation ──────────────────────────────────────


def _generate(j: Journey, path: str, body: dict[str, Any] | None = None) -> None:
    started = check(j.http.post(f"{path}/generation", json=body), 200, 202)
    journey._job(j.http, f"{path}/generation", started["job_id"])


def grow_everything(j: Journey) -> None:
    step("grow: questions, child rounds and recommendations, then completed")
    area = f"{j.child}/growth-areas/{journey.AREA}"
    _generate(j, area, {"kind": "parent_questions", "area_name": "Self-care"})

    def current() -> dict[str, Any]:
        areas = check(j.http.get(f"{j.child}/growth-areas"), 200)["areas"]
        return next(a for a in areas if a["area_id"] == journey.AREA)  # type: ignore[no-any-return]

    questions = current()["parent_questions"]["questions"]
    answers = {
        q["id"]: "He tries on his own first, then asks for help" for q in questions
    }
    saved = {"area_name": "Self-care", "status": "in_progress", "answers": answers}
    check(j.http.put(area, json=saved), 200, 201)
    _generate(j, area, {"kind": "child_rounds"})
    _generate(j, area, {"kind": "recommendations"})
    done = current()
    rounds = done["child_rounds"]["rounds"]
    if not rounds or not done.get("ai_three_month_recommendations"):
        raise WalkFailed(f"grow's generations came back empty: {done}")
    picks = [r["a"]["id"] for r in rounds]
    completed = {
        **saved,
        "status": "completed",
        "child_activity": {"selections": picks},
    }
    check(j.http.put(area, json=completed), 200)


def transform_everything(j: Journey) -> None:
    step("transform: the plan, a photo, the event, its tracker and the Life Pathway")
    plan = f"{j.child}/transform"
    check(j.http.patch(plan, json={"ask": "Help him get dressed on his own"}), 200)
    _generate(j, plan, {"kind": "plan"})
    body = {"field_key": "week_1", "content_type": "image/jpeg"}
    presigned = check(j.http.post(f"{plan}/photos/presign", json=body), 200)
    journey._upload(presigned["upload_url"], "image/jpeg")
    check(
        j.http.patch(plan, json={"photos": {"week_1": [presigned["photo_key"]]}}), 200
    )
    event = {
        "event_name": "Dressed by himself",
        "event_date": "2027-01-24",
        "event_set": True,
    }
    check(j.http.patch(plan, json=event), 200)
    _generate(j, plan, {"kind": "event_tracker"})
    _generate(j, plan, {"kind": "life_pathway", "area_id": journey.AREA})
    view = check(j.http.get(plan), 200)
    pathway = next(a for a in view["areas"] if a["area_id"] == journey.AREA)
    if not view.get("track_steps") or not pathway.get("life_pathway_milestones"):
        raise WalkFailed(f"transform's generations came back empty: {view}")
    if not view.get("completed_at"):
        raise WalkFailed("Transform isn't done after the plan and the event")


def release_everything(j: Journey) -> None:
    step("release: the observations, the first watch, then a new set")
    observations = f"{j.child}/observations"
    _generate(j, observations)
    first = check(j.http.get(observations), 200)["items"][0]["id"]
    watched = check(
        j.http.patch(observations, json={"watching": [first], "span": "2 weeks"}), 200
    )
    _generate(j, observations)
    again = check(j.http.get(observations), 200)
    # A new set replaces the last and clears what was watched; Release stays done.
    if again["watching"] or again["completed_at"] != watched["completed_at"]:
        raise WalkFailed(f"the regeneration didn't keep Release done: {again}")


def children(j: Journey) -> None:
    step("children: the list and a change")
    listed = check(j.http.get(f"{API}/children"), 200)
    if [c["id"] for c in listed] != [j.child_id]:
        raise WalkFailed(f"the list isn't the parent's one child: {listed}")
    changed = check(j.http.patch(j.child, json={"school": "Hillside Primary"}), 200)
    if changed["school"] != "Hillside Primary":
        raise WalkFailed(f"the change didn't stick: {changed}")


# ── shared ─────────────────────────────────────────────────────────────────────


def _tone() -> bytes:
    """One second of a 440 Hz tone, as a WAV recording."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        frames = (
            int(8000 * math.sin(2 * math.pi * 440 * n / 16000)) for n in range(16000)
        )
        out.writeframes(b"".join(struct.pack("<h", f) for f in frames))
    return buffer.getvalue()


def shared(j: Journey) -> None:
    step("shared: health, speech-to-text and the APK link")
    health = check(httpx.get(f"{GATEWAY}/api/health"), 200)
    if health.get("status") != "ok":
        raise WalkFailed(f"health: {health}")
    files = {"audio": ("voice.wav", _tone(), "audio/wav")}
    spoken = check(j.http.post(f"{API}/speech/transcriptions", files=files), 200)
    if "transcript" not in spoken:
        raise WalkFailed(f"no transcript: {spoken}")
    s3 = boto3.client(
        "s3", endpoint_url=MOTO_URL, region_name=REGION,
        aws_access_key_id="local", aws_secret_access_key="local",
    )  # fmt: skip
    key = f"{APK_PREFIX}app-release-e2e-{uuid.uuid4()}.apk"
    s3.put_object(Bucket=ASSETS_BUCKET, Key=key, Body=b"e2e apk")
    try:
        link = check(j.http.get(f"{API}/downloads/apk"), 200)
        if link["expires_in"] != 300 or link["filename"] != "superpower-android.apk":
            raise WalkFailed(f"the APK link: {link}")
        got = httpx.get(
            link["url"].replace("http://host.docker.internal:5050", MOTO_URL)
        )
        if got.status_code != 200 or not got.content:
            raise WalkFailed(f"the APK download -> {got.status_code}")
    finally:
        s3.delete_object(Bucket=ASSETS_BUCKET, Key=key)


# ── admin ──────────────────────────────────────────────────────────────────────


def _register() -> tuple[str, str, str]:
    """A plain new account: (email, password, user id)."""
    email, password = seed_email(), new_password()
    tokens = register(None, email, password, "E2E")
    return email, password, journey._claims(tokens["access_token"])["sub"]


def admin(j: Journey) -> None:
    step("admin: accounts, reads with the owner's location, lock, unlock, role")
    admin_email, admin_password, admin_id = _register()
    other_email, other_password, other_id = _register()
    local_admin(admin_id, j.location, admin=True)
    try:
        signed_in = _login(admin_email, admin_password)
        http = httpx.Client(timeout=30, headers=_bearer(signed_in["access_token"]))
        check(http.get(f"{API}/auth/accounts"), 200)
        found = check(
            http.post(f"{API}/auth/accounts/search", json={"email": j.email}), 200
        )
        if j.user_id not in str(found):
            raise WalkFailed(f"the search didn't find the parent: {found}")
        owner = {"location": j.location}
        listed = check(
            http.get(f"{API}/children", params={"user_id": j.user_id, **owner}), 200
        )
        if [c["id"] for c in listed] != [j.child_id]:
            raise WalkFailed(f"the admin's list: {listed}")
        check(http.get(j.child, params=owner), 200)
        check(http.get(f"{j.child}/personality", params=owner), 200)
        # An admin reads but never writes a child.
        check(http.patch(j.child, json={"school": "x"}), 403)

        check(
            http.post(f"{API}/auth/accounts/{j.user_id}/lock", params=owner), 200, 204
        )
        check(j.http.get(j.child), 401, 403)  # the parent's session stops at once
        _login(j.email, j.password, expect=403)  # account_locked
        check(
            http.post(f"{API}/auth/accounts/{j.user_id}/unlock", params=owner), 200, 204
        )
        _signed_in(j)
        check(j.http.get(j.child), 200)

        role = f"{API}/auth/accounts/{other_id}/role"
        check(http.patch(role, json={"role": "admin"}, params=owner), 200)
        promoted = _login(other_email, other_password)
        me = check(
            httpx.get(f"{API}/auth/me", headers=_bearer(promoted["access_token"])), 200
        )
        if me.get("role") != "admin":
            raise WalkFailed(f"the promotion didn't stick: {me}")
        check(http.patch(role, json={"role": "parent"}, params=owner), 200)
    finally:
        local_admin(admin_id, j.location, admin=False)

    step("admin: the two extra accounts deleted")
    for email, password, user_id in (
        (admin_email, admin_password, admin_id),
        (other_email, other_password, other_id),
    ):
        tokens = _login(email, password)
        check(
            httpx.request(
                "DELETE", f"{API}/auth/account", json={"confirm_email": email},
                headers=_bearer(tokens["access_token"]),
            ),
            202,
        )  # fmt: skip
        poll(
            lambda user_id=user_id: auth_gone(user_id),
            bool,
            f"account {user_id} deleted",
            120,
        )


# ── the walk ───────────────────────────────────────────────────────────────────


def walk_everything() -> Journey:
    j = journey.start()
    account(j)
    journey.onboarding(j)
    journey.discover(j)
    for part in (grow_everything, transform_everything, release_everything):
        part(j)
    journey.connect(j)
    for part in (children, shared, admin):
        part(j)
    return j


def main() -> int:
    try:
        walk_everything()
    except WalkFailed as exc:
        print(f"!! {exc}")
        return 1
    print("\nFULL JOURNEY PASSED: every endpoint answered as it should")
    return 0


if __name__ == "__main__":
    sys.exit(main())
