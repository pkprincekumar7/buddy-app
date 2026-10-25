"""The children service (build plan 4.1). The plan's checks:
- avatar keys only under `…/avatar/`;
- files over 5 MB rejected;
- the 10-children limit;
- unknown fields rejected.
Plus ownership, one child.changed snapshot per write, progress.profile, and the
internal read-through."""

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
from children_testkit import (
    ADMIN,
    BUCKET,
    LOCATION,
    OTHER,
    PARENT,
    Running,
    add_child,
    auth_header,
    running,
    service_header,
)
from fastapi.routing import APIRoute

from children.app import main
from children.app.runtime import Runtime
from children.app.store import CHILDREN
from common.routers import assert_every_route_has_a_policy

API = "/api/v1/children"


def live(mongo_uri: str, test: Callable[[Running], Awaitable[None]], **options: Any) -> None:
    async def go() -> None:
        async with running(mongo_uri, **options) as r:
            await test(r)

    asyncio.run(go())


def _code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


async def _events(r: Running, child_id: str) -> list[dict[str, Any]]:
    rows = await r.db.outbox.find({"aggregate_id": child_id}).sort("version", 1).to_list(None)
    return [
        {"type": row["event_type"], "version": row["version"], **row["payload"]} for row in rows
    ]


def _put_photo(r: Running, key: str, *, size: int = 1024, content_type: str = "image/jpeg") -> None:
    s3 = r.runtime.uploads.client
    s3.put_object(Bucket=BUCKET, Key=key, Body=b"x" * size, ContentType=content_type)


# ── shape ──────────────────────────────────────────────────────────────────────


def test_every_route_declares_a_policy_and_stays_on_its_app():
    assert_every_route_has_a_policy(main.app)
    assert_every_route_has_a_policy(main.internal_app)
    public = {r.path for r in main.app.routes if isinstance(r, APIRoute)}
    assert public == {"/health", API, f"{API}/{{id}}", f"{API}/{{id}}/avatar/presign"}
    internal = {r.path for r in main.internal_app.routes if isinstance(r, APIRoute)}
    assert internal == {"/internal/ping", "/internal/children/{id}"}


def _public(method: str, path: str, **kwargs: Any) -> httpx.Response:
    async def go() -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://c"
        ) as http:
            return await http.request(method, path, **kwargs)

    return asyncio.run(go())


def test_health_and_an_unconfigured_service():
    assert _public("GET", "/health").json() == {"status": "ok", "service": "children"}
    assert _public("GET", API, headers=auth_header()).status_code == 503


# ── create and read ────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_parent_adds_a_child_and_one_snapshot_is_published(mongo_uri):
    async def test(r: Running) -> None:
        response = await add_child(
            r, age=9, gender="boy", school="Green Valley", avatar_id="capper-boy"
        )
        assert response.status_code == 201
        child = response.json()
        assert child["name"] == "Aarav" and child["avatar_url"] is None
        assert child["progress"] == {
            "profile": True, "conversation": False, "discover": False, "grow": False,
            "transform": False, "release": False, "connect": False,
        }  # fmt: skip
        doc = await r.db[CHILDREN].find_one({"_id": child["id"]})
        assert doc is not None
        assert (doc["user_id"], doc["location"], doc["version"], doc["is_deleted"]) == (
            PARENT, LOCATION, 1, False,
        )  # fmt: skip
        assert await _events(r, child["id"]) == [
            {
                "type": "child.changed", "version": 1, "user_id": PARENT, "name": "Aarav", "age": 9,
                "gender": "boy", "is_deleted": False, "progress": child["progress"],
            }
        ]  # fmt: skip
        # Without age and gender, the profile step isn't done yet.
        partial = (await add_child(r, name="Mira")).json()
        assert partial["progress"]["profile"] is False

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    "body",
    [
        {"name": "  "},
        {"name": "x" * 256},
        {"name": "A", "age": 26},
        {"name": "A", "age": -1},
        {"name": "A", "age": "12 years"},
        {"name": "A", "gender": "x" * 51},
        {"name": "A", "school": "x" * 301},
        {"name": "A", "strengths": ["kind"]},  # onboarding's answers
        {"name": "A", "progress": {"discover": True}},  # children's own, set by events
        {"name": "A", "avatar_key": "uploads/in/x/avatar/y.jpg"},  # a photo comes later
        {"name": "A", "onboarding_completed": True},
    ],
)
def test_unknown_or_invalid_fields_are_422(mongo_uri, body):
    async def test(r: Running) -> None:
        response = await r.http.post(API, json=body, headers=auth_header())
        assert response.status_code == 422
        assert await r.db[CHILDREN].count_documents({}) == 0

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_parent_has_at_most_10_children(mongo_uri):
    async def test(r: Running) -> None:
        ids = [(await add_child(r, name=f"Child {n}")).json()["id"] for n in range(10)]
        limit = await add_child(r, name="Eleventh")
        assert (limit.status_code, _code(limit)) == (422, "child_limit")
        # A deleted child frees a place; another parent has their own 10.
        assert (await r.http.delete(f"{API}/{ids[0]}", headers=auth_header())).status_code == 204
        assert (await add_child(r, name="Eleventh")).status_code == 201
        assert (await add_child(r, OTHER, name="Theirs")).status_code == 201

    live(mongo_uri, test)


@pytest.mark.live_service
def test_home_lists_only_your_live_children_in_one_query(mongo_uri):
    async def test(r: Running) -> None:
        names = ["Bea", "Aarav", "Cleo"]
        for name in names:
            await add_child(r, name=name)
        await add_child(r, OTHER, name="Not mine")
        newest_first = (await r.http.get(API, headers=auth_header())).json()
        assert [c["name"] for c in newest_first] == ["Cleo", "Aarav", "Bea"]
        by_name = (await r.http.get(API, params={"sort": "name"}, headers=auth_header())).json()
        assert [c["name"] for c in by_name] == ["Aarav", "Bea", "Cleo"]
        reverse = (
            await r.http.get(API, params={"sort": "-name", "limit": 2}, headers=auth_header())
        ).json()
        assert [c["name"] for c in reverse] == ["Cleo", "Bea"]
        oldest = (
            await r.http.get(API, params={"sort": "created_at"}, headers=auth_header())
        ).json()
        assert oldest[0]["name"] == "Bea"
        for bad in ({"sort": "-created_date"}, {"limit": 0}, {"limit": 201}):
            assert (await r.http.get(API, params=bad, headers=auth_header())).status_code == 422

    live(mongo_uri, test)


@pytest.mark.live_service
def test_someone_elses_child_is_not_found(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        path = f"{API}/{child['id']}"
        for method, body in (("GET", None), ("PATCH", {"name": "X"}), ("DELETE", None)):
            response = await r.http.request(method, path, json=body, headers=auth_header(OTHER))
            assert (response.status_code, _code(response)) == (404, "child_not_found")
        presign = await r.http.post(
            f"{path}/avatar/presign", json={"content_type": "image/png"}, headers=auth_header(OTHER)
        )
        assert presign.status_code == 404
        assert (await r.http.get(path)).status_code == 401
        mine = await r.http.get(path, headers=auth_header())
        assert mine.status_code == 200 and mine.json()["id"] == child["id"]

    live(mongo_uri, test)


@pytest.mark.live_service
def test_admins_read_with_the_owners_location_and_never_write(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        admin = auth_header(ADMIN)
        listed = await r.http.get(
            API, params={"user_id": PARENT, "location": LOCATION}, headers=admin
        )
        assert [c["id"] for c in listed.json()] == [child["id"]]
        one = await r.http.get(f"{API}/{child['id']}", params={"location": LOCATION}, headers=admin)
        assert one.status_code == 200
        reads = [
            (e.permission, e.subject_id) for e in r.audit if e.privileged and e.outcome == "allowed"
        ]
        assert reads == [("children:read:any", PARENT)] * 2
        no_location = await r.http.get(f"{API}/{child['id']}", headers=admin)
        assert (no_location.status_code, _code(no_location)) == (422, "location_required")
        assert (await r.http.get(API, params={"user_id": PARENT}, headers=admin)).status_code == 422
        elsewhere = await r.http.get(
            f"{API}/{child['id']}", params={"location": "us"}, headers=admin
        )
        assert elsewhere.status_code == 404
        # A parent can't read another family's list.
        nosy = await r.http.get(
            API, params={"user_id": OTHER, "location": LOCATION}, headers=auth_header()
        )
        assert (nosy.status_code, _code(nosy)) == (403, "forbidden")
        # Admins don't add or change children.
        for method, path, body in (
            ("POST", API, {"name": "A"}),
            ("PATCH", f"{API}/{child['id']}", {"name": "B"}),
            ("DELETE", f"{API}/{child['id']}", None),
            ("POST", f"{API}/{child['id']}/avatar/presign", {"content_type": "image/png"}),
        ):
            refused = await r.http.request(method, path, json=body, headers=admin)
            assert (refused.status_code, _code(refused)) == (403, "parents_only")

    live(mongo_uri, test)


# ── update ─────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_patch_publishes_only_when_what_circles_copy_changes(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r, name="Mira")).json()
        path = f"{API}/{child['id']}"
        # School and avatar aren't copied anywhere: no event.
        school = await r.http.patch(
            path, json={"school": "Hill School", "avatar_id": "star"}, headers=auth_header()
        )
        assert school.status_code == 200 and school.json()["school"] == "Hill School"
        assert len(await _events(r, child["id"])) == 1
        # Age and gender complete the profile: one snapshot with both and the flag.
        done = await r.http.patch(path, json={"age": 7, "gender": "girl"}, headers=auth_header())
        assert done.json()["progress"]["profile"] is True
        events = await _events(r, child["id"])
        assert [(e["version"], e["age"], e["progress"]["profile"]) for e in events] == [
            (1, None, False), (3, 7, True),
        ]  # fmt: skip
        # Clearing age later doesn't undo the one-way flag.
        cleared = await r.http.patch(path, json={"age": None}, headers=auth_header())
        assert cleared.json()["age"] is None and cleared.json()["progress"]["profile"] is True
        # The same value again isn't a change worth an event.
        before = len(await _events(r, child["id"]))
        await r.http.patch(path, json={"gender": "girl"}, headers=auth_header())
        assert len(await _events(r, child["id"])) == before
        doc = await r.db[CHILDREN].find_one({"_id": child["id"]})
        assert doc is not None and doc["version"] == 5

    live(mongo_uri, test)


@pytest.mark.live_service
@pytest.mark.parametrize(
    "body",
    [{}, {"name": None}, {"visited_tabs": ["home"]}, {"avatar_id": "a", "avatar_key": "k"}],
)
def test_an_invalid_patch_is_422(mongo_uri, body):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        assert (
            await r.http.patch(f"{API}/{child['id']}", json=body, headers=auth_header())
        ).status_code == 422

    live(mongo_uri, test)


# ── photos ─────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_photo_is_uploaded_saved_shown_and_replaced(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r, avatar_id="capper-boy")).json()
        path = f"{API}/{child['id']}"
        presign = await r.http.post(
            f"{path}/avatar/presign", json={"content_type": "image/png"}, headers=auth_header()
        )
        assert presign.status_code == 200
        body = presign.json()
        assert body["avatar_key"].startswith(f"uploads/{LOCATION}/{child['id']}/avatar/")
        assert body["avatar_key"].endswith(".png") and "X-Amz-Signature" in body["upload_url"]
        _put_photo(r, body["avatar_key"], content_type="image/png")
        saved = await r.http.patch(
            path, json={"avatar_key": body["avatar_key"]}, headers=auth_header()
        )
        assert saved.status_code == 200
        assert saved.json()["avatar_id"] is None and saved.json()["avatar_url"].startswith(
            "https://"
        )
        # A new photo replaces it, and the old object is deleted after the change.
        second = (
            await r.http.post(
                f"{path}/avatar/presign", json={"content_type": "image/jpeg"}, headers=auth_header()
            )
        ).json()
        _put_photo(r, second["avatar_key"])
        await r.http.patch(path, json={"avatar_key": second["avatar_key"]}, headers=auth_header())
        s3 = r.runtime.uploads.client
        keys = [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])]
        assert keys == [second["avatar_key"]]
        # An emoji avatar clears the photo (and deletes it).
        emoji = await r.http.patch(path, json={"avatar_id": "star"}, headers=auth_header())
        assert emoji.json()["avatar_url"] is None
        assert s3.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0
        # No avatar change publishes an event: nobody else holds avatars.
        assert len(await _events(r, child["id"])) == 1

    live(mongo_uri, test)


@pytest.mark.live_service
def test_avatar_keys_only_under_this_childs_avatar_prefix(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        other = (await add_child(r, name="Other")).json()
        path = f"{API}/{child['id']}"
        for key in (
            f"uploads/{LOCATION}/{child['id']}/ninety-day-plan/{uuid.uuid4()}.jpg",  # transform's
            f"uploads/{LOCATION}/{other['id']}/avatar/{uuid.uuid4()}.jpg",  # another child's
            f"uploads/us/{child['id']}/avatar/{uuid.uuid4()}.jpg",  # another zone
            f"uploads/{LOCATION}/{child['id']}/{uuid.uuid4()}.jpg",  # today's layout
            "https://evil.example/photo.jpg",
        ):
            _put_photo(r, key) if key.startswith("uploads/") else None
            response = await r.http.patch(path, json={"avatar_key": key}, headers=auth_header())
            assert (response.status_code, _code(response)) == (422, "invalid_avatar_key"), key

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_photo_must_be_uploaded_an_image_and_at_most_5_mb(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        path = f"{API}/{child['id']}"

        async def key() -> str:
            presign = await r.http.post(
                f"{path}/avatar/presign", json={"content_type": "image/jpeg"}, headers=auth_header()
            )
            return str(presign.json()["avatar_key"])

        missing = await r.http.patch(path, json={"avatar_key": await key()}, headers=auth_header())
        assert (missing.status_code, _code(missing)) == (422, "avatar_not_uploaded")
        big = await key()
        _put_photo(r, big, size=5 * 1024 * 1024 + 1)
        too_large = await r.http.patch(path, json={"avatar_key": big}, headers=auth_header())
        assert (too_large.status_code, _code(too_large)) == (422, "avatar_too_large")
        exact = await key()
        _put_photo(r, exact, size=5 * 1024 * 1024)
        assert (
            await r.http.patch(path, json={"avatar_key": exact}, headers=auth_header())
        ).status_code == 200
        not_image = await key()
        _put_photo(r, not_image, content_type="application/pdf")
        refused = await r.http.patch(path, json={"avatar_key": not_image}, headers=auth_header())
        assert (refused.status_code, _code(refused)) == (422, "unsupported_image_type")
        bad_type = await r.http.post(
            f"{path}/avatar/presign", json={"content_type": "image/svg+xml"}, headers=auth_header()
        )
        assert (bad_type.status_code, _code(bad_type)) == (415, "unsupported_image_type")

    live(mongo_uri, test)


@pytest.mark.live_service
def test_without_an_uploads_bucket_photos_are_503(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        path = f"{API}/{child['id']}"
        presign = await r.http.post(
            f"{path}/avatar/presign", json={"content_type": "image/png"}, headers=auth_header()
        )
        assert (presign.status_code, _code(presign)) == (503, "uploads_not_configured")
        key = f"uploads/{LOCATION}/{child['id']}/avatar/{uuid.uuid4()}.png"
        patch = await r.http.patch(path, json={"avatar_key": key}, headers=auth_header())
        assert patch.status_code == 503

    live(mongo_uri, test, uploads=False)


@pytest.mark.live_service
def test_s3_failures_are_reported_not_hidden(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        path = f"{API}/{child['id']}"
        uploads = r.runtime.uploads
        assert uploads is not None

        async def broken(*args: Any, **kwargs: Any) -> str:
            raise RuntimeError("S3 down")

        monkeypatch.setattr(uploads, "presign_put", broken)
        failed = await r.http.post(
            f"{path}/avatar/presign", json={"content_type": "image/png"}, headers=auth_header()
        )
        assert (failed.status_code, _code(failed)) == (502, "upload_url_failed")
        # An old photo that can't be deleted doesn't fail the change.
        key = f"uploads/{LOCATION}/{child['id']}/avatar/{uuid.uuid4()}.png"
        _put_photo(r, key, content_type="image/png")
        assert (
            await r.http.patch(path, json={"avatar_key": key}, headers=auth_header())
        ).status_code == 200
        monkeypatch.setattr(uploads, "delete", broken)
        assert (
            await r.http.patch(path, json={"avatar_id": "star"}, headers=auth_header())
        ).status_code == 200

    live(mongo_uri, test)


# ── delete ─────────────────────────────────────────────────────────────────────


@pytest.mark.live_service
def test_a_deleted_child_is_hidden_and_announced(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        path = f"{API}/{child['id']}"
        assert (await r.http.delete(path, headers=auth_header())).status_code == 204
        doc = await r.db[CHILDREN].find_one({"_id": child["id"]})
        assert doc is not None and doc["is_deleted"] and doc["deleted_at"] and doc["version"] == 2
        events = await _events(r, child["id"])
        assert (events[-1]["type"], events[-1]["is_deleted"], events[-1]["version"]) == (
            "child.changed",
            True,
            2,
        )
        assert (await r.http.get(path, headers=auth_header())).status_code == 404
        assert (await r.http.get(API, headers=auth_header())).json() == []
        assert (await r.http.delete(path, headers=auth_header())).status_code == 404

    live(mongo_uri, test)


@pytest.mark.live_service
def test_a_child_deleted_during_a_change_is_not_found(mongo_uri, monkeypatch):
    async def test(r: Running) -> None:
        child = (await add_child(r)).json()
        real = main._owned

        async def then_deleted(runtime: Runtime, caller: Any, child_id: str) -> dict[str, Any]:
            doc = await real(runtime, caller, child_id)
            await runtime.db[CHILDREN].update_one({"_id": child_id}, {"$set": {"is_deleted": True}})
            return doc

        monkeypatch.setattr(main, "_owned", then_deleted)
        for method, body in (("PATCH", {"name": "B"}), ("DELETE", None)):
            await r.db[CHILDREN].update_one({"_id": child["id"]}, {"$set": {"is_deleted": False}})
            response = await r.http.request(
                method, f"{API}/{child['id']}", json=body, headers=auth_header()
            )
            assert response.status_code == 404

    live(mongo_uri, test)


# ── the internal read-through ──────────────────────────────────────────────────


@pytest.mark.live_service
def test_circles_read_a_childs_access_fields_deleted_or_not(mongo_uri):
    async def test(r: Running) -> None:
        child = (await add_child(r, age=9, gender="boy")).json()
        path = f"/internal/children/{child['id']}"
        response = await r.internal.get(
            path, params={"location": LOCATION}, headers=service_header()
        )
        assert response.json() == {
            "child_id": child["id"], "user_id": PARENT, "location": LOCATION, "name": "Aarav",
            "age": 9, "gender": "boy", "is_deleted": False, "progress": child["progress"], "version": 1,
        }  # fmt: skip
        await r.http.delete(f"{API}/{child['id']}", headers=auth_header())
        deleted = await r.internal.get(
            path, params={"location": LOCATION}, headers=service_header()
        )
        assert deleted.json()["is_deleted"] is True and deleted.json()["version"] == 2
        assert (
            await r.internal.get(path, params={"location": "us"}, headers=service_header())
        ).status_code == 404
        assert (
            await r.internal.get(
                path, params={"location": LOCATION}, headers=service_header("users")
            )
        ).status_code == 403
        assert (await r.internal.get(path, params={"location": LOCATION})).status_code == 401
        assert (await r.internal.get("/internal/ping")).json()["service"] == "children"

    live(mongo_uri, test)


# ── limits and configuration ───────────────────────────────────────────────────


@pytest.mark.live_service
def test_creating_is_limited_to_20_a_minute(mongo_uri):
    async def test(r: Running) -> None:
        statuses = [(await add_child(r, name=f"C{n}")).status_code for n in range(21)]
        assert statuses.count(429) == 1 and statuses[-1] == 429

    live(mongo_uri, test)


def test_from_env_builds_every_part(fake_aws_credentials, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    for name in ("REDIS_URL", "AWS_ENDPOINT_URL", "UPLOADS_BUCKET_NAME"):
        monkeypatch.delenv(name, raising=False)
    from children_testkit import CHILDREN_PRIVATE, JWT_PUBLIC, KID

    env = {
        "MONGODB_URI": "mongodb://x", "MONGODB_DB_NAME": "x",
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "c1", "INTERNAL_SIGNING_KEY": CHILDREN_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": "{}",
    }  # fmt: skip
    plain = Runtime.from_env(env)
    assert plain.uploads is None and plain.settings.service_name == "children"
    asyncio.run(plain.aclose())
    with_photos = Runtime.from_env(
        {**env, "UPLOADS_BUCKET_NAME": BUCKET, "AWS_ENDPOINT_URL": "http://localhost:5050"}
    )
    assert with_photos.uploads is not None and with_photos.uploads.config.bucket == BUCKET
    asyncio.run(with_photos.aclose())


@pytest.mark.live_service
def test_the_lifespan_shares_one_runtime(mongo_uri, monkeypatch, fake_aws_credentials):
    from children_testkit import CHILDREN_PRIVATE, JWT_PUBLIC, KID

    db_name = f"children_env_{uuid.uuid4().hex[:8]}"
    for key, value in {
        "MONGODB_URI": mongo_uri, "MONGODB_DB_NAME": db_name,
        "JWT_PUBLIC_KEYS": json.dumps({KID: JWT_PUBLIC}),
        "INTERNAL_SIGNING_KID": "c1", "INTERNAL_SIGNING_KEY": CHILDREN_PRIVATE,
        "INTERNAL_PUBLIC_KEYS": "{}",
    }.items():  # fmt: skip
        monkeypatch.setenv(key, value)

    async def run() -> None:
        async with (
            main.app.router.lifespan_context(main.app),
            main.internal_app.router.lifespan_context(main.internal_app),
        ):
            assert main.app.state.runtime is main.internal_app.state.runtime is not None
        assert main.app.state.runtime is None
        from pymongo import AsyncMongoClient

        client: AsyncMongoClient[dict[str, Any]] = AsyncMongoClient(mongo_uri)
        assert {"children", "outbox", "tombstones"} <= set(
            await client[db_name].list_collection_names()
        )
        await client.drop_database(db_name)
        await client.close()

    asyncio.run(run())
    monkeypatch.delenv("MONGODB_URI")

    async def unconfigured() -> None:
        async with main.app.router.lifespan_context(main.app):
            assert main.app.state.runtime is None

    asyncio.run(unconfigured())
