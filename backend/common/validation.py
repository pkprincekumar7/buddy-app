"""422 responses that don't echo what was sent (production-readiness review, PRIV-01).

FastAPI's default handler for a request that fails validation returns each error with the
submitted value (`input`) and its context (`ctx`). So a too-short password, or a child's
details that break a rule, come straight back in the response body, where proxies, client
error reporting and browser tools can keep them. This handler returns the same 422 with
only each error's `type`, `loc` and `msg`, which say what to fix without repeating it.

common.serve installs it on both of every service's apps, unless a service has its own.
"""

from __future__ import annotations

from typing import cast

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


async def validation_error_response(request: Request, exc: Exception) -> JSONResponse:
    # Registered for RequestValidationError only (Starlette types handlers as Exception).
    errors = cast(RequestValidationError, exc).errors()
    return JSONResponse(
        {"detail": [{"type": e["type"], "loc": list(e["loc"]), "msg": e["msg"]} for e in errors]},
        status_code=422,
    )


def redact_validation_errors(app: FastAPI) -> None:
    """Answer `app`'s validation errors without the submitted values. Only FastAPI's own
    handler (which every app starts with) is replaced; one the service set is kept."""
    if app.exception_handlers.get(RequestValidationError) is request_validation_exception_handler:
        app.add_exception_handler(RequestValidationError, validation_error_response)
