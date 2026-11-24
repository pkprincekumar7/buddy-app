"""common.cookies: the session cookies' names, prefixed when deployed (AUTH-05)."""

import importlib

import pytest

from common import cookies


@pytest.mark.parametrize("app_env", ["dev", "sbx", "stg", "prod"])
def test_deployed_names_carry_the_browser_enforced_prefixes(app_env):
    assert cookies.session_cookie_names(app_env) == (
        "__Host-access_token",
        "__Secure-refresh_token",
    )


def test_locally_the_names_are_bare_since_plain_http_drops_prefixed_cookies():
    assert cookies.session_cookie_names("local") == ("access_token", "refresh_token")


def test_the_names_follow_app_env(monkeypatch):
    try:
        monkeypatch.setenv("APP_ENV", "prod")
        assert importlib.reload(cookies).ACCESS_COOKIE == "__Host-access_token"
        monkeypatch.delenv("APP_ENV")
        assert importlib.reload(cookies).REFRESH_COOKIE == "refresh_token"
    finally:
        monkeypatch.delenv("APP_ENV", raising=False)
        importlib.reload(cookies)
