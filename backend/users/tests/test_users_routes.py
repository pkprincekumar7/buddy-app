"""users' public API (docs/auth-users-split-api.md): route policies, the ownership matrix
(self, admin with `?location=`, anyone else 404), validation, auditing and rate limits."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
from fastapi.routing import APIRoute
from users_testkit import (
    ADMIN,
    LOCATION,
    OTHER,
    PARENT,
    Running,
    auth_header,
    create_profile,
    running,
)

from common.routers import assert_every_route_has_a_policy
from users.app import main
from users.app.store import USERS

NOT_FOUND = {"detail": {"code": "profile_not_found", "msg": "Profile not found"}}


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]]) -> None:
    async def go() -> None:
        async with running(mongo_uri) as r:
            await test(r)

    asyncio.run(go())


# ── shape ──────────────────────────────────────────────────────────────────────


def test_every_route_on_both_apps_declares_a_policy():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)


def _paths(app: Any) -> set[str]:
    return {route.path for route in app.routes if isinstance(route, APIRoute)}


def test_internal_routes_stay_on_the_internal_app():
    assert all(path.startswith("/internal/") for path in _paths(main.internal_app))
    assert not any(path.startswith("/internal") for path in _paths(main.app))
    assert {"/health", "/api/v1/users/profiles", "/api/v1/users/{user_id}/profile"} <= _paths(
        main.app
    )


def _public(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://u"
        ) as http:
            return await http.request(method, path, **kwargs)

    return asyncio.run(go())


def test_health_is_public_and_no_docs_are_served():
    assert _public("GET", "/health").json() == {"status": "ok", "service": "users"}
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert _public("GET", path).status_code == 404


def test_without_configuration_routes_answer_503():
    response = _public("GET", "/api/v1/users/me/profile", headers=auth_header())
    assert response.status_code == 503


# ── the ownership matrix ───────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_user_reads_their_own_profile_by_id_or_me(mongo_uri):
    async def test(r: Running) -> None:
        assert (await create_profile(r, address_line_one="1 High St")).status_code == 201
        for who in (PARENT, "me"):
            response = await r.http.get(f"/api/v1/users/{who}/profile", headers=auth_header())
            assert response.status_code == 200
            body = response.json()
            assert body["id"] == PARENT and body["first_name"] == "Jane"
            assert body["address_line_one"] == "1 High St" and body["location"] == LOCATION
            assert "email" not in body and "full_name" not in body and "preferences" not in body
        # Reading your own data isn't privileged, so it isn't audited.
        assert r.audit == []

    live(mongo_uri, test)


@pytest.mark.live_service
def test_someone_elses_profile_looks_exactly_like_a_missing_one(mongo_uri):
    async def test(r: Running) -> None:
        await create_profile(r)
        others = await r.http.get(f"/api/v1/users/{PARENT}/profile", headers=auth_header(OTHER))
        missing = await r.http.get(
            f"/api/v1/users/{uuid.uuid4()}/profile",
            headers=auth_header(ADMIN),
            params={"location": LOCATION},
        )
        own_missing = await r.http.get("/api/v1/users/me/profile", headers=auth_header(OTHER))
        for response in (others, missing, own_missing):
            assert (response.status_code, response.json()) == (404, NOT_FOUND)
        bodies: dict[str, dict[str, Any]] = {
            "profile": {"first_name": "X"},
            "preferences": {"tts_enabled": False},
        }
        for path, body in bodies.items():
            patch = await r.http.patch(
                f"/api/v1/users/{PARENT}/{path}", json=body, headers=auth_header(OTHER)
            )
            assert (patch.status_code, patch.json()) == (404, NOT_FOUND)
        # The denial is audited; the profile is unchanged.
        assert any(e.outcome == "denied" and e.subject_id == PARENT for e in r.audit)
        doc = await r.runtime.db[USERS].find_one({"_id": PARENT})
        assert doc is not None and doc["first_name"] == "Jane" and doc["version"] == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_admin_reads_anyones_profile_with_its_location(mongo_uri):
    async def test(r: Running) -> None:
        await create_profile(r)
        path = f"/api/v1/users/{PARENT}/profile"
        response = await r.http.get(path, headers=auth_header(ADMIN), params={"location": LOCATION})
        assert response.status_code == 200 and response.json()["id"] == PARENT
        assert [(e.permission, e.subject_id, e.privileged) for e in r.audit] == [
            ("profiles:read:any", PARENT, True)
        ]
        # Without ?location= it's refused; with another zone's it isn't found.
        without = await r.http.get(path, headers=auth_header(ADMIN))
        assert (
            without.status_code == 422 and without.json()["detail"]["code"] == "location_required"
        )
        elsewhere = await r.http.get(path, headers=auth_header(ADMIN), params={"location": "us"})
        assert (elsewhere.status_code, elsewhere.json()) == (404, NOT_FOUND)
        bad = await r.http.get(path, headers=auth_header(ADMIN), params={"location": "Not A Zone"})
        assert bad.status_code == 422
        # An admin's own profile needs no location.
        await create_profile(r, ADMIN, first_name="Ada")
        own = await r.http.get("/api/v1/users/me/profile", headers=auth_header(ADMIN))
        assert own.json()["first_name"] == "Ada"

    live(mongo_uri, test)


@pytest.mark.live_service
def test_signed_out_is_401(mongo_uri):
    async def test(r: Running) -> None:
        for method, path in (
            ("GET", "/api/v1/users/me/profile"),
            ("PATCH", "/api/v1/users/me/preferences"),
            ("GET", f"/api/v1/users/profiles?ids={PARENT}"),
        ):
            assert (await r.http.request(method, path)).status_code == 401

    live(mongo_uri, test)


# ── PATCH profile ──────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_patch_replaces_only_the_fields_sent(mongo_uri):
    async def test(r: Running) -> None:
        await create_profile(r, middle_name="Q", address_line_two="Flat 2")
        response = await r.http.patch(
            "/api/v1/users/me/profile",
            json={"first_name": "  Janet ", "middle_name": None, "address_line_two": ""},
            headers=auth_header(),
        )
        assert response.status_code == 200
        body = response.json()
        assert (body["first_name"], body["middle_name"], body["last_name"]) == (
            "Janet",
            None,
            "Doe",
        )
        assert body["address_line_two"] is None
        doc = await r.runtime.db[USERS].find_one({"_id": PARENT})
        assert doc is not None and doc["version"] == 2 and doc["updated_at"] > doc["created_at"]
        # No event: user.profile_updated is reserved (7.6).
        assert await r.runtime.db.outbox.count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    "body",
    [
        {},
        {"first_name": None},
        {"first_name": "   "},
        {"first_name": "x" * 101},
        {"last_name": "x" * 101},
        {"address_line_one": "x" * 201},
        {"email": "a@b.c"},
        {"full_name": "Jane Doe"},
    ],
)
def test_an_invalid_patch_is_422(mongo_uri, body):
    async def test(r: Running) -> None:
        await create_profile(r)
        response = await r.http.patch("/api/v1/users/me/profile", json=body, headers=auth_header())
        assert response.status_code == 422
        doc = await r.runtime.db[USERS].find_one({"_id": PARENT})
        assert doc is not None and doc["version"] == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_an_admin_change_is_audited_with_the_field_names_only(mongo_uri):
    async def test(r: Running) -> None:
        await create_profile(r)
        response = await r.http.patch(
            f"/api/v1/users/{PARENT}/profile",
            json={"last_name": "Smith", "address_line_one": "2 Low Rd"},
            headers=auth_header(ADMIN),
            params={"location": LOCATION},
        )
        assert response.status_code == 200 and response.json()["last_name"] == "Smith"
        changes = [e for e in r.audit if e.changed_fields]
        assert [(e.permission, e.subject_id, e.changed_fields) for e in changes] == [
            ("profiles:write:any", PARENT, ("address_line_one", "last_name"))
        ]
        assert "2 Low Rd" not in repr(r.audit) and "Smith" not in repr(r.audit)
        # Missing profile for an admin write: 404, not an upsert.
        gone = await r.http.patch(
            f"/api/v1/users/{OTHER}/profile",
            json={"last_name": "X"},
            headers=auth_header(ADMIN),
            params={"location": LOCATION},
        )
        assert (gone.status_code, gone.json()) == (404, NOT_FOUND)
        assert await r.runtime.db[USERS].find_one({"_id": OTHER}) is None

    live(mongo_uri, test)


# ── preferences ────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_preferences_default_to_tts_on_and_can_be_changed(mongo_uri):
    async def test(r: Running) -> None:
        await create_profile(r)
        path = "/api/v1/users/me/preferences"
        assert (await r.http.get(path, headers=auth_header())).json() == {"tts_enabled": True}
        response = await r.http.patch(path, json={"tts_enabled": False}, headers=auth_header())
        assert response.json() == {"tts_enabled": False}
        assert (await r.http.get(path, headers=auth_header())).json() == {"tts_enabled": False}
        for body in ({}, {"tts_enabled": False, "dark_mode": True}, {"last_visited_path": "/"}):
            assert (await r.http.patch(path, json=body, headers=auth_header())).status_code == 422
        # An admin, with the owner's location, is audited by field name.
        admin = await r.http.patch(
            f"/api/v1/users/{PARENT}/preferences",
            json={"tts_enabled": True},
            headers=auth_header(ADMIN),
            params={"location": LOCATION},
        )
        assert admin.json() == {"tts_enabled": True}
        assert [e.changed_fields for e in r.audit if e.changed_fields] == [("tts_enabled",)]
        # No profile, no preferences.
        missing = await r.http.get(path, headers=auth_header(OTHER))
        assert (missing.status_code, missing.json()) == (404, NOT_FOUND)
        assert (
            await r.http.patch(path, json={"tts_enabled": True}, headers=auth_header(OTHER))
        ).status_code == 404

    live(mongo_uri, test)


# ── the admin batch lookup ─────────────────────────────────────────────────────


@pytest.mark.live_service
def test_admins_get_names_for_a_page_of_accounts(mongo_uri):
    async def test(r: Running) -> None:
        await create_profile(r, PARENT, middle_name="Q", address_line_one="1 High St")
        await create_profile(r, OTHER, first_name="Sam", last_name=None)
        unknown = str(uuid.uuid4())
        response = await r.http.get(
            "/api/v1/users/profiles",
            params={"ids": f"{OTHER}, {unknown},{PARENT},{OTHER}"},
            headers=auth_header(ADMIN),
        )
        assert response.status_code == 200
        assert response.json() == {
            "items": [
                {"id": OTHER, "first_name": "Sam", "middle_name": None, "last_name": None},
                {"id": PARENT, "first_name": "Jane", "middle_name": "Q", "last_name": "Doe"},
            ]
        }
        assert "address_line_one" not in response.text
        # Audited: the check itself, then one event per id requested.
        subjects = [e.subject_id for e in r.audit if e.permission == "profiles:read:any"]
        assert subjects == [None, OTHER, unknown, PARENT]

    live(mongo_uri, test)


@pytest.mark.live_service
def test_the_batch_lookup_is_admin_only_and_validated(mongo_uri):
    async def test(r: Running) -> None:
        path = "/api/v1/users/profiles"
        parent = await r.http.get(path, params={"ids": PARENT}, headers=auth_header())
        assert parent.status_code == 403
        too_many = ",".join(str(uuid.uuid4()) for _ in range(101))
        for ids in ("", " , ", "not-a-uuid", PARENT.upper(), too_many):
            response = await r.http.get(path, params={"ids": ids}, headers=auth_header(ADMIN))
            assert response.status_code == 422, ids
        assert (await r.http.get(path, headers=auth_header(ADMIN))).status_code == 422

    live(mongo_uri, test)


# ── rate limits ────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_reads_are_limited_to_60_a_minute_per_user(mongo_uri):
    async def test(r: Running) -> None:
        await create_profile(r)
        path = "/api/v1/users/me/preferences"
        statuses = [(await r.http.get(path, headers=auth_header())).status_code for _ in range(61)]
        assert statuses[:60] == [200] * 60
        assert statuses[60] == 429
        # Per user and per route: another user, or another route, isn't affected.
        assert (await r.http.get(path, headers=auth_header(OTHER))).status_code == 404
        assert (
            await r.http.get("/api/v1/users/me/profile", headers=auth_header())
        ).status_code == 200

    live(mongo_uri, test)
