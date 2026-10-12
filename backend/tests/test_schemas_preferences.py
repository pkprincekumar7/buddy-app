"""app/schemas/preferences.py — the models behind /user/preferences."""

import pytest
from pydantic import ValidationError

from app.schemas.preferences import UserPreferences, UserPreferencesPatch


def test_preference_defaults():
    assert UserPreferences().model_dump() == {
        "tts_enabled": True,
        "dark_mode": True,
        "last_visited_path": None,
    }


def test_patch_tracks_which_fields_were_sent():
    # The route only writes fields in model_fields_set, so an explicit null
    # (clear it) must be distinguishable from an omitted field (leave it).
    assert UserPreferencesPatch().model_fields_set == set()
    patch = UserPreferencesPatch(dark_mode=False, last_visited_path=None)
    assert patch.model_fields_set == {"dark_mode", "last_visited_path"}
    assert patch.last_visited_path is None


@pytest.mark.parametrize(
    "path",
    ["/", "/children/c1", "/grow?tab=1&x=2", "/a#section", "/naïve/ü", "/a b", "/" + "a" * 499],
)
def test_safe_relative_paths_are_accepted(path):
    assert UserPreferencesPatch(last_visited_path=path).last_visited_path == path


@pytest.mark.parametrize(
    "path",
    [
        "",
        "relative/path",  # not rooted
        "//evil.example/x",  # protocol-relative open redirect
        "https://evil.example",
        "javascript:alert(1)",
        "/a:b",  # no colons anywhere
        "/a\\b",
        '/a"onload=x',
        "/a'b",
        "/a`b",
        "/<script>",
        "/a>b",
        "/a\nb",
        "/grow\n",  # trailing newline: Python's $ would have let this through
        "/grow\r",
        "/a\tb",
        "/a\x00b",
        "/grow\x7f",  # DEL
        "/" + "a" * 500,  # over max_length
    ],
)
def test_unsafe_paths_are_rejected(path):
    with pytest.raises(ValidationError):
        UserPreferencesPatch(last_visited_path=path)


def test_booleans_are_validated():
    with pytest.raises(ValidationError):
        UserPreferencesPatch(tts_enabled="sometimes")
