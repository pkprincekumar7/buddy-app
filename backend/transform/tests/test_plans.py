"""Plan and tracker answers: each activity and evidence field keeps an id of its own
(plans.unique_ids)."""

import re

from transform.app import plans
from transform.app.store import MAP_KEY_PATTERN


def test_repeated_field_keys_in_an_activity_are_numbered():
    answer = {
        "acts": [
            {
                "do": [
                    {"k": "photo", "kind": "photo", "label": "Sketch photo"},
                    {"k": "photo", "kind": "photo", "label": "Finished build photo"},
                    {"k": "photo", "kind": "photo", "label": "Shown to a friend"},
                    {"k": "what", "kind": "text", "label": "What he built"},
                ]
            },
            {"do": [{"k": "photo", "kind": "photo", "label": "Another activity"}]},
        ]
    }
    keys = [[f["k"] for f in act["do"]] for act in plans.unique_ids(answer)["acts"]]
    # Unique within an activity; another activity may reuse a key (the app adds its id).
    assert keys == [["photo", "photo2", "photo3", "what"], ["photo"]]


def test_tracker_keys_are_unique_across_all_its_steps():
    # The app stores a tracker's answers by key across every step, not per step.
    answer = {
        "steps": [
            {"fields": [{"k": "date"}, {"k": "note"}]},
            {"fields": [{"k": "date"}]},
            {"fields": [{"k": "note"}, {"k": "date"}]},
        ]
    }
    keys = [[f["k"] for f in step["fields"]] for step in plans.unique_ids(answer)["steps"]]
    assert keys == [["date", "note"], ["date2"], ["note2", "date3"]]


def test_a_numbered_key_stays_within_the_schema_length():
    long = "x" * 20
    answer = {"steps": [{"fields": [{"k": long}, {"k": long}]}]}
    keys = [f["k"] for f in plans.unique_ids(answer)["steps"][0]["fields"]]
    assert keys == [long, "x" * 19 + "2"]
    assert all(len(k) <= 20 for k in keys)


def test_a_suffix_never_lands_on_a_key_already_used():
    answer = {"acts": [{"do": [{"k": "a"}, {"k": "a2"}, {"k": "a"}]}]}
    assert [f["k"] for f in plans.unique_ids(answer)["acts"][0]["do"]] == ["a", "a2", "a3"]


def test_a_key_is_made_safe_to_save():
    answer = {
        "acts": [{"do": [{"k": "next step"}, {"k": "next/step"}, {"k": "x" * 19 + "…"}, {"k": ""}]}]
    }
    keys = [f["k"] for f in plans.unique_ids(answer)["acts"][0]["do"]]
    # Unsafe characters become "_"; two keys that end up the same are still numbered.
    assert keys == ["next_step", "next_step2", "x" * 19 + "_", "field"]
    assert all(re.fullmatch(MAP_KEY_PATTERN, f"act:m101:{k}") for k in keys)


def test_activities_are_numbered_by_their_place():
    # The apps build an activity's id from its month and `n`: a repeat would merge two.
    answer = {"acts": [{"n": "01", "do": []} for _ in range(9)]}
    assert [a["n"] for a in plans.unique_ids(answer)["acts"]] == [f"0{i}" for i in range(1, 10)]


def test_an_answer_of_another_shape_is_returned_unchanged():
    assert plans.unique_ids(["not", "a", "plan"]) == ["not", "a", "plan"]
    assert plans.unique_ids({"acts": "nope"}) == {"acts": "nope"}
