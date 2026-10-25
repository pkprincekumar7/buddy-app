"""hello: the public health check and the internal ping, each on its own app."""

from fastapi.testclient import TestClient

from common.routers import assert_every_route_has_a_policy
from hello.app.main import app, internal_app


def test_health_is_public():
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "hello"}


def test_ping_is_internal():
    response = TestClient(internal_app).get("/internal/ping")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "hello"}


def test_internal_routes_are_not_on_the_public_app():
    assert TestClient(app).get("/internal/ping").status_code == 404


def test_public_routes_are_not_on_the_internal_app():
    assert TestClient(internal_app).get("/health").status_code == 404


def test_no_docs_or_openapi_are_served():
    client = TestClient(app)
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_every_public_route_declares_an_access_policy():
    # The route-policy test every service runs (design 11.2).
    assert_every_route_has_a_policy(app)
