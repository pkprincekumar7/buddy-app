"""common.validation: 422s say what to fix without echoing what was sent (PRIV-01)."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from common.validation import redact_validation_errors, validation_error_response

SECRET = "hunter2"  # nosec B105 - a test value


class _Body(BaseModel):
    password: str = Field(min_length=12)
    age: int


def _app() -> FastAPI:
    app = FastAPI()

    @app.post("/r")
    async def r(body: _Body) -> dict[str, str]:  # pragma: no cover - never valid here
        return {}

    return app


def test_the_default_handler_echoes_the_value():
    # What this module exists for: FastAPI's own 422 repeats the submitted password.
    response = TestClient(_app()).post("/r", json={"password": SECRET, "age": 1})
    assert SECRET in response.text


def test_a_redacted_422_keeps_type_loc_and_msg_only():
    app = _app()
    redact_validation_errors(app)
    response = TestClient(app).post("/r", json={"password": SECRET, "age": "old"})
    assert response.status_code == 422
    assert SECRET not in response.text
    assert "old" not in response.text
    detail = response.json()["detail"]
    assert [set(e) for e in detail] == [{"type", "loc", "msg"}] * 2
    assert [e["loc"] for e in detail] == [["body", "password"], ["body", "age"]]
    assert detail[0]["type"] == "string_too_short"


def test_a_body_that_isnt_json_is_redacted_too():
    app = _app()
    redact_validation_errors(app)
    response = TestClient(app).post(
        "/r", content=f'{{"password": "{SECRET}"', headers={"content-type": "application/json"}
    )
    assert response.status_code == 422
    assert SECRET not in response.text


def test_a_services_own_handler_is_kept():
    async def own(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"detail": "own"}, status_code=400)

    app = _app()
    app.add_exception_handler(RequestValidationError, own)
    redact_validation_errors(app)
    assert app.exception_handlers[RequestValidationError] is own
    other = _app()
    redact_validation_errors(other)
    assert other.exception_handlers[RequestValidationError] is validation_error_response
