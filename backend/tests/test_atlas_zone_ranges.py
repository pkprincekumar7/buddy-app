import re

from app import models
from app.routing import ATLAS_ZONE_FOR_REGION, REGION_TO_LOCATIONS
from tools.atlas_zone_ranges import SHARD_KEY_SECOND_FIELD, UNSHARDED, zone_setup_script

ALL_COLLECTIONS = {
    value for name, value in vars(models).items() if name.isupper() and isinstance(value, str)
}


def test_every_collection_is_either_sharded_or_explicitly_unsharded():
    # A new collection must be consciously placed: zone-sharded or global.
    assert SHARD_KEY_SECOND_FIELD.keys() | UNSHARDED == ALL_COLLECTIONS
    assert not SHARD_KEY_SECOND_FIELD.keys() & UNSHARDED


def test_every_backend_region_has_an_atlas_zone():
    assert ATLAS_ZONE_FOR_REGION.keys() == REGION_TO_LOCATIONS.keys()


def test_script_assigns_every_location_of_every_collection_to_its_regions_zone():
    script = zone_setup_script("superpower_app")
    ranges = re.findall(
        r'updateZoneKeyRange\("superpower_app\.(\w+)", \{ location: "(\w+)",.*"(\w+)"\);', script
    )
    expected = {
        (coll, loc, ATLAS_ZONE_FOR_REGION[region])
        for coll in SHARD_KEY_SECOND_FIELD
        for region, locs in REGION_TO_LOCATIONS.items()
        for loc in locs
    }
    assert set(ranges) == expected
    assert len(ranges) == len(expected)  # no duplicates


def test_script_shards_each_collection_once_with_location_first():
    script = zone_setup_script("superpower_app")
    sharded = dict(
        re.findall(
            r'shardCollection\("superpower_app\.(\w+)", \{ location: 1, (\w+): 1 \}\)', script
        )
    )
    assert sharded == SHARD_KEY_SECOND_FIELD
