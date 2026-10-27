#!/usr/bin/env python3
"""One made-up child from profile to Connect, through the gateway (Gate 5, build plan 5.x).

Run with the backend venv against the compose `split` stack (docs/getting-started.md):

    backend/.venv/bin/python scripts/e2e/journey.py

It allow-lists a new test email (`auth.seed` in the auth container), registers the account,
gives the child a photo, walks every circle (the generations use the LLM keys in .env, so a
few provider calls) with a 90-day-plan photo, then waits for children to hold all seven
progress flags. The password is generated and never printed. Exit code 0 when the walk
completes. Each circle is a step function, so the other e2e scripts can stop part-way;
full-journey.py walks every endpoint on top of it.
"""

from __future__ import annotations

import base64
import json
import sys
from dataclasses import dataclass, field
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


def _upload(url: str, content_type: str) -> None:
    """PUT a tiny image to a presigned URL; the services sign for Moto as the containers see it."""
    local = url.replace("http://host.docker.internal:5050", MOTO_URL)
    response = httpx.put(
        local,
        content=b"\xff\xd8\xff test image",
        headers={"Content-Type": content_type},
    )
    if response.status_code != 200:
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
    _upload(presigned["upload_url"], "image/jpeg")
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
    check(
        j.http.patch(
            plan, json={"ask": "Help him get dressed on his own in the morning"}
        ),
        200,
    )
    started = check(j.http.post(f"{plan}/generation", json={"kind": "plan"}), 200, 202)
    _job(j.http, f"{plan}/generation", started["job_id"])
    body = {"field_key": "week_1", "content_type": "image/jpeg"}
    presigned = check(j.http.post(f"{plan}/photos/presign", json=body), 200)
    _upload(presigned["upload_url"], "image/jpeg")
    check(
        j.http.patch(plan, json={"photos": {"week_1": [presigned["photo_key"]]}}), 200
    )
    event = {
        "event_name": "Dressed by himself",
        "event_date": "2027-01-24",
        "event_set": True,
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


def walk(email: str | None = None) -> Journey:
    j = start(email)
    for circle in (onboarding, discover, grow, transform, release, connect):
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
