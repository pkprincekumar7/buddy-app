"""common.audit: what gets recorded, where, and the request context (design 11.3)."""

import json
import logging

import pytest
from starlette.requests import Request

from common.audit import (
    AUDIT_LOGGER,
    AuditEvent,
    AuditLog,
    log_sink,
    route_template,
    should_record,
    source_ip,
)


def _event(**overrides) -> AuditEvent:
    fields = {
        "actor_id": "a",
        "actor_role": "admin",
        "permission": "accounts:lock",
        "subject_id": "s",
        "privileged": True,
        "outcome": "allowed",
        "status": 200,
        "method": "POST",
        "route": "/accounts/{id}/lock",
        "request_id": "r-1",
        "source_ip": "203.0.113.9",
        **overrides,
    }
    return AuditEvent(**fields)


def _request(headers: dict[str, str] | None = None, client=("198.51.100.7", 5000), route=None):
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/users/abc/profile",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": client,
    }
    if route is not None:
        scope["route"] = route
    return Request(scope)


@pytest.mark.parametrize(
    ("privileged", "outcome", "recorded"),
    [
        (True, "allowed", True),
        (False, "denied", True),
        (True, "denied", True),
        (False, "allowed", False),
    ],
)
def test_privileged_accesses_and_denials_are_recorded(privileged, outcome, recorded):
    seen: list[AuditEvent] = []
    event = _event(privileged=privileged, outcome=outcome)
    assert should_record(event) is recorded
    AuditLog([seen.append]).record(event)
    assert seen == ([event] if recorded else [])


def test_a_failing_sink_doesnt_stop_the_others(caplog):
    seen: list[AuditEvent] = []

    def broken(event: AuditEvent) -> None:
        raise RuntimeError("log group gone")

    AuditLog([broken, seen.append]).record(_event())
    assert len(seen) == 1
    assert "audit sink" in caplog.text


def test_the_default_sink_writes_one_json_line(caplog):
    with caplog.at_level(logging.INFO, logger=AUDIT_LOGGER):
        AuditLog().record(_event(changed_fields=("role",)))
    (record,) = [r for r in caplog.records if r.name == AUDIT_LOGGER]
    assert json.loads(record.getMessage())["audit"]["changed_fields"] == ["role"]
    assert log_sink in AuditLog().sinks


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("203.0.113.9:443", "203.0.113.9"),
        ("2001:db8::1:443", "2001:db8::1"),
        ("[2001:db8::2]:443", "2001:db8::2"),
    ],
)
def test_source_ip_comes_from_cloudfront(header, expected):
    assert source_ip(_request({"CloudFront-Viewer-Address": header})) == expected


def test_source_ip_falls_back_to_the_peer():
    assert source_ip(_request()) == "198.51.100.7"
    assert source_ip(_request(client=None)) is None


def test_route_template_prefers_the_route_path():
    class Route:
        path = "/api/v1/users/{user_id}/profile"

    assert route_template(_request(route=Route())) == "/api/v1/users/{user_id}/profile"
    assert route_template(_request()) == "/api/v1/users/abc/profile"
