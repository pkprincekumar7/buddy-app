"""common's operations helpers: settings, logging, metrics, rate limits, telemetry (design 15.5).

Includes the build plan's 1.4 check: a log line never carries personal data.
"""

import asyncio
import importlib
import json
import logging
import types
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from limits import parse
from limits.storage import MemoryStorage
from opentelemetry import trace
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic import ValidationError

from common import logging as clog
from common import metrics, telemetry
from common.limiter import RETRY_PRIMARY_AFTER_SECONDS, RateLimits
from common.settings_base import ServiceSettings

# ── settings ───────────────────────────────────────────────────────────────────

BASE_ENV = {
    "SERVICE_NAME": "grow",
    "MONGODB_URI": "mongodb://localhost:27017/?directConnection=true",
    "MONGODB_DB_NAME": "grow",
}


def _settings(monkeypatch, tmp_path, **env: str) -> ServiceSettings:
    monkeypatch.chdir(tmp_path)  # no .env here
    for key in ("REDIS_URL", "APP_ENV", "OTEL_EXPORTER_OTLP_ENDPOINT", "MONGODB_MAX_POOL_SIZE"):
        monkeypatch.delenv(key, raising=False)
    for key, value in {**BASE_ENV, **env}.items():
        monkeypatch.setenv(key, value)
    return ServiceSettings()  # type: ignore[call-arg]  # the fields come from the environment


def test_settings_defaults(monkeypatch, tmp_path):
    settings = _settings(monkeypatch, tmp_path)
    assert settings.mongodb_max_pool_size == 5
    assert settings.redis_url is None and settings.otel_exporter_otlp_endpoint is None
    assert settings.events_prefix == "superpower-local"


def test_blank_optional_settings_are_unset(monkeypatch, tmp_path):
    settings = _settings(
        monkeypatch, tmp_path, REDIS_URL=" ", OTEL_EXPORTER_OTLP_ENDPOINT="", APP_ENV="dev"
    )
    assert settings.redis_url is None and settings.otel_exporter_otlp_endpoint is None
    assert settings.events_prefix == "superpower-dev"


@pytest.mark.parametrize(
    "env",
    [{"SERVICE_NAME": "Grow"}, {"APP_ENV": "qa"}, {"MONGODB_MAX_POOL_SIZE": "0"}],
)
def test_bad_settings_are_refused(monkeypatch, tmp_path, env):
    with pytest.raises(ValidationError):
        _settings(monkeypatch, tmp_path, **env)


def test_the_mongo_client_has_the_pool_limit(monkeypatch, tmp_path):
    settings = _settings(monkeypatch, tmp_path)

    async def main() -> dict[str, Any]:
        client = settings.mongo_client()
        try:
            return {
                "pool": client.options.pool_options.max_pool_size,
                "tz": client.codec_options.tz_aware,
            }
        finally:
            await client.close()

    assert asyncio.run(main()) == {"pool": 5, "tz": True}


# ── logging ────────────────────────────────────────────────────────────────────


def _line(
    record_args: dict[str, Any] | None = None, message: str = "hello", exc: bool = False
) -> dict[str, Any]:
    formatter = clog.JsonFormatter("grow")
    record = logging.LogRecord("svc", logging.INFO, __file__, 1, message, None, None)
    if exc:
        try:
            raise RuntimeError("failed for jane@example.com")
        except RuntimeError:
            import sys

            record.exc_info = sys.exc_info()
    for key, value in (record_args or {}).items():
        setattr(record, key, value)
    return json.loads(formatter.format(record))


def test_a_log_line_never_carries_personal_data():
    line = _line(
        {
            "email": "jane@example.com",
            "first_name": "Jane",
            "Last_Name": "Doe",
            "address": "1 High St",
            "user_id": "u-1",
            "attempt": 3,
            "details": {
                "name": "Mira",
                "phone": "123",
                "child_id": "c-1",
                "note": "mail bob@example.org",
            },
            "items": [{"postcode": "AB1"}, "x@y.io"],
        },
        message="login failed for jane@example.com",
        exc=True,
    )
    text = json.dumps(line)
    for value in (
        "jane@example.com",
        "Jane",
        "Doe",
        "1 High St",
        "Mira",
        "123",
        "AB1",
        "bob@example.org",
        "x@y.io",
    ):
        assert value not in text, value
    assert line["user_id"] == "u-1" and line["details"]["child_id"] == "c-1"  # ids are fine
    assert line["attempt"] == 3
    assert line["message"] == "login failed for [email]"
    assert "[email]" in line["exception"]


def test_a_log_line_has_the_service_level_and_time():
    line = _line()
    assert {line["service"], line["level"], line["logger"], line["message"]} == {
        "grow",
        "INFO",
        "svc",
        "hello",
    }
    assert datetime.fromisoformat(line["time"]).tzinfo is not None
    assert "trace_id" not in line and "request_id" not in line


def test_a_log_line_carries_the_trace_and_request_ids():
    provider, _ = telemetry.setup_telemetry("grow", environment="local", region="ap-south-1")
    tracer = provider.get_tracer("t")
    token = clog.request_id_var.set("req-1")
    try:
        with tracer.start_as_current_span("s") as span:
            line = _line()
            context = span.get_span_context()
    finally:
        clog.request_id_var.reset(token)
    assert line["trace_id"] == format(context.trace_id, "032x")
    assert line["span_id"] == format(context.span_id, "016x")
    assert line["request_id"] == "req-1"


def test_configure_logging_installs_one_json_handler(capsys):
    root = logging.getLogger()
    saved = root.handlers[:], root.level
    try:
        clog.configure_logging("grow", "INFO")
        logging.getLogger("x").info("one line")
        assert len(root.handlers) == 1
        assert json.loads(capsys.readouterr().out.strip().splitlines()[-1])["message"] == "one line"
        assert logging.getLogger("uvicorn.access").level == logging.WARNING
    finally:
        root.handlers[:], _ = saved
        root.setLevel(saved[1])


def test_the_request_id_middleware():
    app = FastAPI()
    app.add_middleware(clog.RequestIdMiddleware)

    @app.get("/x")
    async def x() -> dict[str, str | None]:
        return {"seen": clog.request_id_var.get()}

    client = TestClient(app)
    response = client.get("/x", headers={"X-Request-Id": "gw-123"})
    assert response.json() == {"seen": "gw-123"} and response.headers["x-request-id"] == "gw-123"
    generated = client.get("/x", headers={"X-Request-Id": "bad id!"})
    assert generated.headers["x-request-id"] == generated.json()["seen"] != "bad id!"
    assert clog.request_id_var.get() is None


def test_the_request_id_middleware_passes_other_scopes():
    seen: list[str] = []

    async def app(scope, receive, send):
        seen.append(scope["type"])

    async def receive() -> dict[str, Any]:
        return {}  # pragma: no cover - not called

    async def send(message: Any) -> None:
        return None  # pragma: no cover - not called

    asyncio.run(clog.RequestIdMiddleware(app)({"type": "lifespan"}, receive, send))
    assert seen == ["lifespan"]


# ── metrics ────────────────────────────────────────────────────────────────────


class FakeCloudWatch:
    def __init__(self, fail: bool = False) -> None:
        self.calls: list[dict[str, Any]] = []
        self.fail = fail

    def put_metric_data(self, **kwargs: Any) -> None:
        if self.fail:
            raise ConnectionError("cloudwatch down")
        self.calls.append(kwargs)


def test_metrics_are_batched_into_the_services_namespace():
    cloudwatch = FakeCloudWatch()
    publisher = metrics.MetricsPublisher(cloudwatch, service="grow", environment="dev")
    publisher.put("PendingJobCount", 3)
    publisher.put("OldestRunningJobAgeSeconds", 12.5)
    assert asyncio.run(publisher.flush()) == 2
    (call,) = cloudwatch.calls
    assert call["Namespace"] == "Superpower/grow"
    assert [d["Unit"] for d in call["MetricData"]] == ["Count", "Seconds"]
    assert call["MetricData"][0]["Dimensions"] == [{"Name": "Environment", "Value": "dev"}]
    assert asyncio.run(publisher.flush()) == 0  # nothing left


def test_only_the_alarm_and_scaling_metrics_are_allowed():
    publisher = metrics.MetricsPublisher(FakeCloudWatch(), service="grow", environment="dev")
    with pytest.raises(ValueError, match="alarm or scaling"):
        publisher.put("RequestsPerUser", 1)


def test_large_batches_are_split_and_failures_dropped(monkeypatch):
    monkeypatch.setattr(metrics, "MAX_DATUMS_PER_CALL", 2)
    ok = metrics.MetricsPublisher(FakeCloudWatch(), service="grow", environment="dev")
    for _ in range(5):
        ok.put("PendingJobCount", 1)
    assert asyncio.run(ok.flush()) == 5 and len(ok.cloudwatch.calls) == 3
    broken = metrics.MetricsPublisher(FakeCloudWatch(fail=True), service="grow", environment="dev")
    broken.put("PendingJobCount", 1)
    assert asyncio.run(broken.flush()) == 0


@pytest.mark.live_service
def test_outbox_age(mongo_run):
    async def body(db, client):
        assert await metrics.oldest_unpublished_outbox_age(db, "ap-south-1") == 0.0
        old = datetime.now(UTC) - timedelta(minutes=10)
        await db.outbox.insert_many(
            [
                {"region": "ap-south-1", "published_at": None, "created_at": old},
                {"region": "ap-south-1", "published_at": None, "created_at": datetime.now(UTC)},
                {
                    "region": "eu-west-1",
                    "published_at": None,
                    "created_at": old - timedelta(hours=1),
                },
            ]
        )
        age = await metrics.oldest_unpublished_outbox_age(db, "ap-south-1")
        assert 590 < age < 700

    mongo_run(body)


def test_outbox_age_with_a_naive_date():
    class Coll:
        async def find_one(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
            return {"created_at": (datetime.now(UTC) - timedelta(seconds=30)).replace(tzinfo=None)}

    age = asyncio.run(metrics.oldest_unpublished_outbox_age({"outbox": Coll()}, "ap-south-1"))  # type: ignore[arg-type]
    assert 29 < age < 60


class FakeRedis:
    """SET NX PX and the two scripts, enough for RegionLeader."""

    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.down = False

    async def set(self, key: str, value: str, nx: bool = False, px: int | None = None) -> bool:
        if self.down:
            raise ConnectionError("valkey down")
        if nx and key in self.data:
            return False
        self.data[key] = value
        return True

    async def eval(self, script: str, numkeys: int, key: str, token: str, *args: Any) -> int:
        if self.down:
            raise ConnectionError("valkey down")
        if self.data.get(key) != token:
            return 0
        if "DEL" in script:
            del self.data[key]
        return 1


def test_one_leader_per_region():
    redis = FakeRedis()
    first, second = (
        metrics.RegionLeader(redis, "leader:grow"),
        metrics.RegionLeader(redis, "leader:grow"),
    )

    async def main() -> list[bool]:
        results = [await first.try_lead(), await second.try_lead(), await first.try_lead()]
        await first.release()
        results.append(await second.try_lead())
        redis.down = True
        results.append(await second.try_lead())
        await second.release()  # not leading: nothing to release
        return results

    assert asyncio.run(main()) == [True, False, True, True, False]


def test_a_leader_whose_lock_expired_re_acquires():
    redis = FakeRedis()
    leader = metrics.RegionLeader(redis, "leader:grow")

    async def main() -> bool:
        await leader.try_lead()
        redis.data.clear()  # the lock expired
        return await leader.try_lead()

    assert asyncio.run(main())


def test_without_valkey_every_task_leads():
    leader = metrics.RegionLeader(None, "leader:grow")
    assert asyncio.run(leader.try_lead())
    asyncio.run(leader.release())


def test_release_ignores_errors():
    redis = FakeRedis()
    leader = metrics.RegionLeader(redis, "leader:grow")
    asyncio.run(leader.try_lead())
    redis.down = True
    asyncio.run(leader.release())
    assert not leader.leading


# ── rate limits ────────────────────────────────────────────────────────────────


class Clock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


class FlakyStorage(MemoryStorage):
    """A Valkey stand-in that can go down."""

    def __init__(self) -> None:
        super().__init__()
        self.down = False

    def incr(self, *args: Any, **kwargs: Any) -> int:
        if self.down:
            raise ConnectionError("valkey down")
        return super().incr(*args, **kwargs)


def test_limits_count_in_valkey_then_per_task_while_it_is_down():
    storage, clock = FlakyStorage(), Clock()
    limits = RateLimits(None, prefix="t", primary=storage, clock=clock)
    item = parse("2/minute")
    assert limits.hit(item, "k") and limits.hit(item, "k") and not limits.hit(item, "k")

    storage.down = True
    assert limits.hit(item, "k2")  # counted in process now
    storage.down = False
    assert limits.hit(item, "k2") and not limits.hit(item, "k2")  # still in process: 30 s not up
    clock.now += RETRY_PRIMARY_AFTER_SECONDS
    assert limits.hit(item, "k3")  # back on the primary
    assert storage.get(item.key_for("t", "k3")) == 1


def test_without_valkey_limits_are_per_task():
    limits = RateLimits(None, prefix="t")
    item = parse("1/minute")
    assert limits.hit(item, "a") and not limits.hit(item, "a")


@pytest.mark.live_service
def test_limits_against_real_valkey():
    import os

    url = os.environ.get("REDIS_URL")
    if not url:
        pytest.skip("REDIS_URL not set")
    limits = RateLimits(url, prefix=f"test-{datetime.now(UTC).timestamp()}")
    item = parse("1/minute")
    assert limits.hit(item, "real") and not limits.hit(item, "real")


def test_per_ip_and_per_user_dependencies():
    from common.authz import Caller

    limits = RateLimits(None, prefix="t", behind_proxy=True)
    app = FastAPI()

    async def fake_caller() -> Caller:
        return Caller("3f6c2a1e-8b7d-4c5e-9f10-2a3b4c5d6e7f", "parent", "in", 1, frozenset())

    from common.authz import current_caller

    app.dependency_overrides[current_caller] = fake_caller

    @app.post("/login", dependencies=[Depends(limits.per_ip("1/minute"))])
    async def login() -> dict[str, bool]:
        return {"ok": True}

    @app.patch("/things/{thing_id}", dependencies=[Depends(limits.per_user("1/minute"))])
    async def patch(thing_id: str) -> dict[str, bool]:
        return {"ok": True}

    client = TestClient(app)
    viewer = {"CloudFront-Viewer-Address": "203.0.113.9:443"}
    assert client.post("/login", headers=viewer).status_code == 200
    limited = client.post("/login", headers=viewer)
    assert limited.status_code == 429 and limited.headers["retry-after"] == "60"
    assert (
        client.post("/login", headers={"CloudFront-Viewer-Address": "203.0.113.10:443"}).status_code
        == 200
    )
    assert client.patch("/things/a").status_code == 200
    assert client.patch("/things/a").status_code == 429


def test_client_ip_without_a_proxy_or_peer():
    from starlette.requests import Request

    direct = RateLimits(None, prefix="t")
    proxied = RateLimits(None, prefix="t", behind_proxy=True)
    with_peer = Request({"type": "http", "headers": [], "client": ("198.51.100.1", 1)})
    no_peer = Request({"type": "http", "headers": [], "client": None})
    assert direct.client_ip(with_peer) == "198.51.100.1"
    assert proxied.client_ip(with_peer) == "198.51.100.1"  # no CloudFront header: the peer
    assert direct.client_ip(no_peer) == "unknown"
    assert proxied.client_ip(no_peer) == "unknown"


def test_a_redis_url_builds_a_redis_storage():
    limits = RateLimits("redis://localhost:6379", prefix="t")
    assert limits._primary is not None


# ── telemetry ──────────────────────────────────────────────────────────────────


def test_trace_ids_are_xray_compatible():
    generator = telemetry.XRayIdGenerator()
    before = int(datetime.now(UTC).timestamp())
    trace_id = generator.generate_trace_id()
    assert before <= trace_id >> 96 <= before + 1
    assert generator.generate_span_id() > 0


@pytest.fixture
def uninstrument() -> Iterator[None]:
    """Undo the global instrumentations a test switched on, so other tests run plain."""
    yield
    for library, (module_name, class_name) in telemetry.INSTRUMENTATIONS.items():
        if library != "fastapi":
            instrumentor = getattr(importlib.import_module(module_name), class_name)()
            if instrumentor.is_instrumented_by_opentelemetry:
                instrumentor.uninstrument()


def test_setup_sets_the_resource_and_exports(uninstrument):
    exporter = InMemorySpanExporter()
    provider, enabled = telemetry.setup_telemetry(
        "grow", environment="dev", region="ap-south-1", exporter=exporter
    )
    assert enabled == ["pymongo", "httpx", "botocore", "redis"]  # FastAPI needs an app
    with provider.get_tracer("t").start_as_current_span("work"):
        traceparent = telemetry.current_traceparent()
    provider.force_flush()
    (span,) = exporter.get_finished_spans()
    assert span.resource.attributes["service.name"] == "grow"
    assert span.resource.attributes["deployment.environment"] == "dev"
    assert span.resource.attributes["cloud.region"] == "ap-south-1"
    assert traceparent == f"00-{span.context.trace_id:032x}-{span.context.span_id:016x}-01"


def test_an_endpoint_configures_the_otlp_exporter():
    provider, _ = telemetry.setup_telemetry(
        "grow", environment="dev", region="ap-south-1", endpoint="http://otel-collector:4318/"
    )
    processors = provider._active_span_processor._span_processors
    exporter = cast(Any, processors[0]).span_exporter
    assert exporter._endpoint == "http://otel-collector:4318/v1/traces"
    provider.shutdown()


def test_no_traceparent_outside_a_span():
    assert telemetry.current_traceparent() is None


@pytest.fixture
def spans() -> Iterator[InMemorySpanExporter]:
    """Spans recorded by the global provider (OpenTelemetry sets it once per process)."""
    if not isinstance(trace.get_tracer_provider(), telemetry.TracerProvider):
        telemetry.setup_telemetry("grow", environment="dev", region="ap-south-1")
    exporter = InMemorySpanExporter()
    provider = trace.get_tracer_provider()
    assert isinstance(provider, telemetry.TracerProvider)
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    yield exporter
    exporter.clear()


def test_a_consumer_span_links_to_the_producer_instead_of_continuing_it(spans):
    with trace.get_tracer("t").start_as_current_span("produce"):
        traceparent = telemetry.current_traceparent()
        with telemetry.linked_span("consume child.changed", traceparent, event="child.changed"):
            pass
    consume, produce = spans.get_finished_spans()[-2:]
    assert consume.parent is None  # a new trace, not a child
    assert consume.context.trace_id != produce.context.trace_id
    assert consume.links[0].context.span_id == produce.context.span_id
    assert consume.kind is trace.SpanKind.CONSUMER


@pytest.mark.parametrize("traceparent", [None, "not-a-traceparent"])
def test_a_consumer_span_without_a_valid_parent_has_no_link(spans, traceparent):
    with telemetry.linked_span("consume", traceparent):
        pass
    span = spans.get_finished_spans()[-1]
    assert list(span.links) == []


def test_installed_instrumentations_are_enabled(monkeypatch):
    calls: list[str] = []

    class Instrumentor:
        def __init__(self) -> None:
            pass

        def instrument(self, tracer_provider: Any) -> None:
            calls.append("global")

        @staticmethod
        def instrument_app(app: Any, tracer_provider: Any) -> None:
            calls.append("app")

    def fake_import(name: str) -> Any:
        return types.SimpleNamespace(
            **{cls: Instrumentor for _, cls in telemetry.INSTRUMENTATIONS.values()}
        )

    monkeypatch.setattr(telemetry.importlib, "import_module", fake_import)
    provider = telemetry.TracerProvider()
    assert telemetry.instrument(object(), provider) == list(telemetry.INSTRUMENTATIONS)
    assert calls == ["app", "global", "global", "global", "global"]
    calls.clear()
    assert "fastapi" not in telemetry.instrument(None, provider)  # no app to instrument


def test_a_request_span_continues_the_callers_trace(spans, uninstrument):
    app = FastAPI()

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"ok": "yes"}

    provider = trace.get_tracer_provider()
    assert isinstance(provider, telemetry.TracerProvider)
    assert "fastapi" in telemetry.instrument(app, provider)
    caller_trace = "4bf92f3577b34da6a3ce929d0e0e4736"
    response = TestClient(app).get(
        "/ping", headers={"traceparent": f"00-{caller_trace}-00f067aa0ba902b7-01"}
    )
    assert response.status_code == 200
    server = next(s for s in spans.get_finished_spans() if s.kind is trace.SpanKind.SERVER)
    assert format(server.context.trace_id, "032x") == caller_trace
    assert server.resource.attributes["service.name"]


def test_a_huge_tracestate_header_is_parsed_quickly():
    # GHSA-xcq7-p3pf-p88h: before 1.45.1 this took seconds (O(N²) on the whitespace run).
    import time as _time

    from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

    carrier = {
        "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        "tracestate": "a=b" + " " * 100_000 + "x",
    }
    started = _time.perf_counter()
    TraceContextTextMapPropagator().extract(carrier)
    assert _time.perf_counter() - started < 0.5


def test_a_missing_instrumentation_is_skipped(monkeypatch, caplog):
    def missing(name: str) -> Any:
        raise ImportError(name)

    monkeypatch.setattr(telemetry.importlib, "import_module", missing)
    with caplog.at_level("INFO", logger="common.telemetry"):
        assert telemetry.instrument(object(), telemetry.TracerProvider()) == []
    assert "fastapi instrumentation not installed" in caplog.text
