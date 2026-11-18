"""tools/atlas_zone_ranges.py: the zone scripts, and its collection table against the code."""

import re
from pathlib import Path

import pytest

from common.models import CHILD_ACCESS, JOBS
from common.regions import ATLAS_ZONE_FOR_REGION, REGION_TO_LOCATIONS
from tools import services
from tools.atlas_zone_ranges import SHARDED, UNSHARDED, main, zone_setup_script

BACKEND = Path(__file__).resolve().parents[2]

# What each common helper a service calls at startup creates.
COMMON_COLLECTIONS = {
    "ensure_outbox": {"outbox"},
    "ensure_tombstones": {"tombstones", "guards"},
    "ensure_child_access": {CHILD_ACCESS},
    "ensure_jobs": {JOBS},
    "ensure_pending_uploads": {"pending_uploads"},
    "ensure_inbox": {"inbox"},
}
INPUTS = {
    "ONBOARDING_INPUTS": "onboarding_inputs",
    "PERSONALITY_INPUTS": "personality_inputs",
    "GROWTH_INPUTS": "growth_inputs",
}


def _source(service: str) -> str:
    files = [p for p in (BACKEND / service).rglob("*.py") if "tests" not in p.parts]
    return "\n".join(p.read_text(encoding="utf-8") for p in files)


def _created(service: str) -> set[str]:
    """The collections the service's code creates or uses."""
    source = _source(service)
    store = (BACKEND / service / "app" / "store.py").read_text(encoding="utf-8")
    constants = dict(re.findall(r'^([A-Z_]+)(?:: str)? = "([a-z_]+)"$', store, re.M))
    own = {value for name, value in constants.items() if re.search(rf"\[{name}\]", source)}
    common = set().union(
        *(made for helper, made in COMMON_COLLECTIONS.items() if f"{helper}(" in source)
    )
    for names in re.findall(r"ensure_inputs\([^,]+, \[([A-Z_, ]+)\]\)", source):
        common |= {INPUTS[n.strip()] for n in names.split(",")}
    return own | common


def _with_database() -> list[str]:
    return [s for s in services.discover() if (BACKEND / s / "app" / "store.py").is_file()]


def test_every_service_with_a_database_is_in_the_table():
    assert sorted(SHARDED) == sorted(_with_database())
    assert set(UNSHARDED) <= set(SHARDED)


@pytest.mark.parametrize("service", _with_database())
def test_the_table_lists_exactly_the_collections_the_service_creates(service):
    # A new collection must be consciously placed: zone-sharded or global.
    placed = set(SHARDED[service]) | set(UNSHARDED.get(service, ()))
    assert placed == _created(service)
    assert not set(SHARDED[service]) & set(UNSHARDED.get(service, ()))
    assert len(SHARDED[service]) == len(set(SHARDED[service]))


def test_every_region_has_an_atlas_zone():
    assert ATLAS_ZONE_FOR_REGION.keys() == REGION_TO_LOCATIONS.keys()


@pytest.mark.parametrize("service", sorted(SHARDED))
def test_the_script_assigns_every_location_of_every_collection_to_its_zone(service):
    script = zone_setup_script(service)
    ranges = re.findall(
        rf'updateZoneKeyRange\("{service}\.(\w+)", \{{ location: "(\w+)", _id: MinKey \}}, '
        r'\{ location: "\2", _id: MaxKey \}, "(\w+)"\);',
        script,
    )
    expected = {
        (coll, loc, ATLAS_ZONE_FOR_REGION[region])
        for coll in SHARDED[service]
        for region, locs in REGION_TO_LOCATIONS.items()
        for loc in locs
    }
    assert set(ranges) == expected
    assert len(ranges) == len(expected)  # no duplicates


@pytest.mark.parametrize("service", sorted(SHARDED))
def test_the_script_shards_each_collection_once_with_location_first(service):
    sharded = re.findall(
        rf'shardCollection\("{service}\.(\w+)", \{{ location: 1, _id: 1 \}}\);',
        zone_setup_script(service),
    )
    assert sharded == list(SHARDED[service])
    for coll in UNSHARDED.get(service, ()):
        assert f".{coll}" not in zone_setup_script(service).split("// 1.")[1]


def test_cli_prints_every_database_or_the_ones_named(capsys):
    assert main([]) == 0
    out = capsys.readouterr().out
    assert all(f"for database '{s}'" in out for s in SHARDED)
    assert main(["users"]) == 0
    assert capsys.readouterr().out == zone_setup_script("users")
    assert main(["shared"]) == 2
    assert "no database for: shared" in capsys.readouterr().err
    with pytest.raises(KeyError, match="shared"):
        zone_setup_script("shared")
