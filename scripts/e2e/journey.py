#!/usr/bin/env python3
"""One made-up child from profile to Connect, through the gateway (Gate 5, build plan 5.x).

Run with the backend venv against the local compose stack (docs/getting-started.md):

    backend/.venv/bin/python scripts/e2e/journey.py

It allow-lists a new test email (`auth.seed` in the auth container), registers the account,
gives the child a photo, walks every circle (the generations use the LLM keys in .env, so a
few provider calls) with a 90-day-plan photo, then waits for children to hold all seven
progress flags, and then plays child view (docs/child-view-build-plan.md): every kids
endpoint, with no LLM call. The password is generated and never printed. Exit code 0 when
the walk completes. Each circle is a step function, so the other e2e scripts can stop part-way;
full-journey.py walks every endpoint on top of it.
"""

from __future__ import annotations

import base64
import json
import sys
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import httpx
from stack import (
    API,
    MOTO_URL,
    WalkFailed,
    check,
    new_password,
    poll,
    register,
    seed_email,
    step,
)

CHILD_NAME = "Test Kid"


@dataclass
class Journey:
    email: str
    user_id: str
    location: str
    child_id: str
    http: httpx.Client
    password: str = field(repr=False, default="")  # generated, never printed

    @property
    def child(self) -> str:
        return f"{API}/children/{self.child_id}"


def _job(http: httpx.Client, path: str, job_id: str) -> None:
    body = poll(
        lambda: http.get(f"{path}/{job_id}").json(),
        lambda b: b.get("status") in ("completed", "failed"),
        f"job {job_id}",
    )
    if body["status"] != "completed":
        raise WalkFailed(f"job failed: {body}")


def _claims(token: str) -> dict[str, Any]:
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def _upload(url: str, fields: dict[str, str], content_type: str) -> None:
    """POST a tiny image with a presigned form (APP-07): the signed fields, then the file.
    The services sign for Moto as the containers see it."""
    local = url.replace("http://moto:5000", MOTO_URL)
    response = httpx.post(
        local,
        data=fields,
        files={"file": ("photo.jpg", b"\xff\xd8\xff test image", content_type)},
    )
    if response.status_code not in (200, 204):
        raise WalkFailed(
            f"photo upload -> {response.status_code}: {response.text[:300]}"
        )


# ── the steps, in the journey's order ──────────────────────────────────────────


def start(email: str | None = None) -> Journey:
    """A new account with one child: a complete profile and a photo."""
    email = email or seed_email()
    http = httpx.Client(timeout=30)
    password = new_password()
    step("register")
    tokens = register(http, email, password, "Gate")
    http.cookies.clear()
    http.headers["Authorization"] = f"Bearer {tokens['access_token']}"
    claims = _claims(tokens["access_token"])

    step("children: a child with a complete profile and a photo")
    body = {"name": CHILD_NAME, "age": 8, "gender": "boy"}
    child = check(http.post(f"{API}/children", json=body), 201)
    if not child["progress"]["profile"]:
        raise WalkFailed(f"profile not complete: {child['progress']}")
    journey = Journey(
        email, claims["sub"], claims["location"], child["id"], http, password
    )
    presigned = check(
        http.post(
            f"{journey.child}/avatar/presign", json={"content_type": "image/jpeg"}
        ),
        200,
    )
    _upload(presigned["upload_url"], presigned["upload_fields"], "image/jpeg")
    check(http.patch(journey.child, json={"avatar_key": presigned["avatar_key"]}), 200)
    return journey


def onboarding(j: Journey) -> None:
    step("onboarding: the seven answers")
    answers = {
        "strengths": ["Building with blocks", "Kind to friends"],
        "hobbies": ["Lego", "Football"],
        "thinking_pattern": "Likes to work things out step by step",
        "communication_style": "Talks through his ideas out loud",
        "energy_level": "High in the morning, calmer after lunch",
        "social_behaviour": "Warms up slowly, then joins in",
        "emotional_behaviour": "Gets upset when a tower falls over",
    }
    check(j.http.put(f"{j.child}/onboarding", json=answers), 201)


def discover(j: Journey) -> None:
    step("discover: the personality (started by the worker), then the reveal")
    personality = poll(
        lambda: j.http.get(f"{j.child}/personality").json(),
        lambda b: b.get("status") in ("ready", "failed"),
        "personality",
    )
    if personality["status"] != "ready":
        raise WalkFailed(f"personality failed: {personality}")
    check(j.http.post(f"{j.child}/personality/viewed"), 200)


AREA = "self_care"


def start_grow(j: Journey) -> str:
    """The area's questions, generating: returns the job id."""
    body = {"kind": "parent_questions", "area_name": "Self-care"}
    started = check(
        j.http.post(f"{j.child}/growth-areas/{AREA}/generation", json=body), 200, 202
    )
    return str(started["job_id"])


def grow(j: Journey) -> None:
    step("grow: one area from questions to completed")
    area = f"{j.child}/growth-areas/{AREA}"
    _job(j.http, f"{area}/generation", start_grow(j))
    areas = check(j.http.get(f"{j.child}/growth-areas"), 200)["areas"]
    questions = areas[0]["parent_questions"]["questions"]
    answers = {
        q["id"]: "He tries on his own first, then asks for help" for q in questions
    }
    body = {"area_name": "Self-care", "status": "completed", "answers": answers}
    check(j.http.put(area, json=body), 200, 201)


def transform(j: Journey) -> None:
    step("transform: the plan, a photo, then the Day-90 event")
    plan = f"{j.child}/transform"
    # Each save is made on the version the last response showed (409 otherwise).
    version = check(j.http.get(plan), 200)["version"]
    ask = {"ask": "Help him get dressed on his own in the morning", "version": version}
    version = check(j.http.patch(plan, json=ask), 200)["version"]
    started = check(j.http.post(f"{plan}/generation", json={"kind": "plan"}), 200, 202)
    _job(j.http, f"{plan}/generation", started["job_id"])
    body = {"field_key": "week_1", "content_type": "image/jpeg"}
    presigned = check(j.http.post(f"{plan}/photos/presign", json=body), 200)
    _upload(presigned["upload_url"], presigned["upload_fields"], "image/jpeg")
    photos = {"photos": {"week_1": [presigned["photo_key"]]}, "version": version}
    version = check(j.http.patch(plan, json=photos), 200)["version"]
    event = {
        "event_name": "Dressed by himself",
        "event_date": "2027-01-24",
        "event_set": True,
        "version": version,
    }
    check(j.http.patch(plan, json=event), 200)


def release(j: Journey) -> None:
    step("release: the observations, then start tracking")
    started = check(j.http.post(f"{j.child}/observations/generation"), 200, 202)
    _job(j.http, f"{j.child}/observations/generation", started["job_id"])
    first = check(j.http.get(f"{j.child}/observations"), 200)["items"][0]["id"]
    check(
        j.http.patch(
            f"{j.child}/observations", json={"watching": [first], "span": "2 weeks"}
        ),
        200,
    )


def connect(j: Journey) -> None:
    step("connect: the visit")
    check(j.http.post(f"{j.child}/connect/visit"), 200)
    step("children: every flag, once the workers have relayed the events")
    final = poll(
        lambda: j.http.get(j.child).json(),
        lambda b: all(b.get("progress", {}).values()),
        "all seven progress flags",
        timeout=90,
    )
    print(f"   progress: {final['progress']}")


def child_view(j: Journey) -> None:
    """Child view on top of the finished circles, in child view's own order (each circle opens
    once the one before is done there): every kids endpoint, the stars the server gives, and
    the parent-side reads. No LLM call (the powers come from the stored personality)."""
    step("child view: Discover's powers and games, then Grow locked until they're done")
    today = date.today().isoformat()
    kids = f"{j.child}/kids"
    at = {"date": today}

    def event(body: dict[str, Any], *ok: int) -> dict[str, Any]:
        return check(  # type: ignore[no-any-return]
            j.http.post(f"{kids}/events", params=at, json=body), *(ok or (200,))
        )

    start = check(j.http.get(kids, params=at), 200)
    if start["stars"] != 0 or any(start["circles_done"].values()):
        raise WalkFailed(f"a new child already has activity: {start}")
    # The parent's circles are all done, yet child view starts at Discover.
    event({"type": "mood", "mood": "good"}, 403)
    powers = check(j.http.get(f"{j.child}/personality/powers"), 200)
    if len(powers["powers"]) != 7 or not powers["style"]:
        raise WalkFailed(f"the powers aren't seven: {powers}")
    for power in range(7):
        event({"type": "flip_power", "power": power})
    event({"type": "flip_power", "power": 0})  # again: nothing more
    event({"type": "try_power", "power": 0})
    event({"type": "game_best", "game": "focus", "seconds": 4.2})
    games = event(
        {"type": "game_best", "game": "focus", "seconds": 9.0}
    )  # slower: 4.2 kept
    if not games["circles_done"]["discover"] or games["best_times"] != {"focus": 4.2}:
        raise WalkFailed(f"the activity isn't what was done: {games}")

    step("child view: a Grow world, then a Transform quest")
    worlds = f"{j.child}/growth-areas/worlds"
    if len(check(j.http.get(worlds), 200)["worlds"]) != 6:
        raise WalkFailed("the worlds aren't six")
    ran = check(j.http.post(f"{worlds}/1/runs", json={"scores": [80, 70, 60]}), 200)
    if [r["total"] for r in ran["runs"]["1"]] != [70]:
        raise WalkFailed(f"the world run wasn't kept: {ran['runs']}")
    # grow publishes grow.world_played with the run; children's worker marks Grow done.
    poll(
        lambda: check(j.http.get(kids, params=at), 200),
        lambda b: b["circles_done"]["grow"],
        "Grow done in child view (grow.world_played)",
        timeout=90,
    )
    quests = f"{j.child}/transform/quests"
    check(j.http.put(f"{quests}/current", params=at, json={"interest": "space"}), 200)
    logged = check(
        j.http.post(f"{quests}/log", params=at, json={"interest": "space", "quest": 0}),
        200,
    )
    again = check(
        j.http.post(f"{quests}/log", params=at, json={"interest": "space", "quest": 0}),
        200,
    )
    if logged["logs"] != {"space:0": 1} or again["logs"] != {"space:0": 1}:
        raise WalkFailed(f"a quest counted more than once a day: {again['logs']}")
    # transform publishes transform.quest_logged with the counted log; children's worker
    # gives the quest's star and marks Transform done.
    poll(
        lambda: check(j.http.get(kids, params=at), 200),
        lambda b: b["circles_done"]["transform"],
        "Transform done in child view (transform.quest_logged)",
        timeout=90,
    )

    step("child view: Release's mood, Connect's win, then the parent's reads")
    mood = event({"type": "mood", "mood": "good", "note": "A test note."})
    if mood["moods"].get(today, {}).get("mood") != "good":
        raise WalkFailed(f"today's mood wasn't kept: {mood['moods']}")
    win = {
        "type": "show_win",
        "key": "badge:discover",
        "title": "Discover badge unlocked",
    }
    shown = event(win)
    # 7 flips + the badge (3) + a try + the quest + the mood; game times, worlds and wins give none.
    if shown["stars"] != 7 + 3 + 1 + 1 + 1:
        raise WalkFailed(f"the stars aren't the server's sum: {shown['stars']}")
    if "badge:discover" not in shown["shown"] or not all(
        shown["circles_done"].values()
    ):
        raise WalkFailed(
            f"child view isn't done after every circle: {shown['circles_done']}"
        )
    seen = check(j.http.get(quests, params=at), 200)
    if seen["last_logged"] != {"space:0": today}:
        raise WalkFailed(f"the parent can't see when the quest was done: {seen}")


def walk(email: str | None = None) -> Journey:
    j = start(email)
    for circle in (onboarding, discover, grow, transform, release, connect, child_view):
        circle(j)
    return j


def main() -> int:
    try:
        walk(sys.argv[1] if len(sys.argv) > 1 else None)
    except WalkFailed as exc:
        print(f"!! {exc}")
        return 1
    print("\nJOURNEY PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
