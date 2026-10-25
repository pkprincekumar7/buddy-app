"""OpenTelemetry for every service (docs/auth-users-split.md, 15.5).

`setup_telemetry(...)` once at startup:
- resource attributes `service.name`, `deployment.environment`, `cloud.region`;
- X-Ray-compatible trace ids (the first 32 bits are the start time), so traces are valid in X-Ray;
- W3C `traceparent` propagation between services;
- every span sent to the shared collector over OTLP/HTTP (100% head sampling: the collector
  does tail sampling, keeping every error and slow trace). No endpoint, no export (local);
- the FastAPI, PyMongo, httpx, botocore and redis instrumentations, each enabled if its
  package is installed.

Events carry traces too: the producer stores `current_traceparent()` on the outbox row,
and the consumer runs its handler in `linked_span(...)`, a new trace linked to the
producer's span rather than its child, so asynchronous work doesn't stretch the request's.
"""

from __future__ import annotations

import importlib
import logging
import random
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from opentelemetry import propagate, trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter
from opentelemetry.sdk.trace.id_generator import IdGenerator
from opentelemetry.sdk.trace.sampling import ALWAYS_ON
from opentelemetry.trace import Link, Span
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

_logger = logging.getLogger(__name__)

# (module, class) per library; FastAPI is instrumented per app, the rest globally.
INSTRUMENTATIONS: dict[str, tuple[str, str]] = {
    "fastapi": ("opentelemetry.instrumentation.fastapi", "FastAPIInstrumentor"),
    "pymongo": ("opentelemetry.instrumentation.pymongo", "PymongoInstrumentor"),
    "httpx": ("opentelemetry.instrumentation.httpx", "HTTPXClientInstrumentor"),
    "botocore": ("opentelemetry.instrumentation.botocore", "BotocoreInstrumentor"),
    "redis": ("opentelemetry.instrumentation.redis", "RedisInstrumentor"),
}


class XRayIdGenerator(IdGenerator):
    """Trace ids X-Ray accepts: the start time in seconds, then 96 random bits."""

    def __init__(self) -> None:
        self._random = random.SystemRandom()

    def generate_span_id(self) -> int:
        return self._random.getrandbits(64) or 1

    def generate_trace_id(self) -> int:
        return (int(time.time()) << 96) | self._random.getrandbits(96)


def setup_telemetry(
    service: str,
    *,
    environment: str,
    region: str,
    endpoint: str | None = None,
    app: Any = None,
    exporter: SpanExporter | None = None,
) -> tuple[TracerProvider, list[str]]:
    """Configure tracing for this process. Returns the provider and the instrumented libraries."""
    provider = TracerProvider(
        resource=Resource.create(
            {"service.name": service, "deployment.environment": environment, "cloud.region": region}
        ),
        id_generator=XRayIdGenerator(),
        sampler=ALWAYS_ON,
    )
    if exporter is None and endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        exporter = OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces")
    if exporter is not None:
        provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    propagate.set_global_textmap(TraceContextTextMapPropagator())
    return provider, instrument(app, provider)


def instrument(app: Any, provider: TracerProvider) -> list[str]:
    """Turn on every installed instrumentation; a missing one is logged, not fatal."""
    enabled: list[str] = []
    for library, (module_name, class_name) in INSTRUMENTATIONS.items():
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            _logger.info("telemetry: %s instrumentation not installed", library)
            continue
        instrumentor = getattr(module, class_name)
        if library == "fastapi":
            if app is None:
                continue
            instrumentor.instrument_app(app, tracer_provider=provider)
        else:
            instrumentor().instrument(tracer_provider=provider)
        enabled.append(library)
    return enabled


def current_traceparent() -> str | None:
    """The current span as a W3C `traceparent`, for an outbox row or an outgoing call."""
    carrier: dict[str, str] = {}
    TraceContextTextMapPropagator().inject(carrier)
    return carrier.get("traceparent")


@contextmanager
def linked_span(name: str, traceparent: str | None, **attributes: Any) -> Iterator[Span]:
    """A new root span linked to the producer's span in `traceparent` (if any)."""
    links: list[Link] = []
    if traceparent:
        remote = trace.get_current_span(
            TraceContextTextMapPropagator().extract({"traceparent": traceparent})
        ).get_span_context()
        if remote.is_valid:
            links.append(Link(remote))
    tracer = trace.get_tracer("common.events")
    with tracer.start_as_current_span(
        name,
        context=trace.set_span_in_context(trace.INVALID_SPAN),
        links=links,
        kind=trace.SpanKind.CONSUMER,
        attributes=attributes,
    ) as span:
        yield span
