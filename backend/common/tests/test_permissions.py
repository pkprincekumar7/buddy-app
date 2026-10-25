"""common.permissions: the role → permission table (design 11.1, 11.2)."""

import pytest

from common import permissions


def test_admin_holds_everything_and_parent_only_self():
    assert permissions.permissions_for("admin") == permissions.PERMISSIONS
    assert permissions.permissions_for("parent") == permissions.SELF_PERMISSIONS
    assert all(p.endswith(":self") for p in permissions.SELF_PERMISSIONS)


def test_an_unknown_role_holds_nothing():
    assert permissions.permissions_for("guest") == frozenset()


def test_every_design_permission_is_in_the_table():
    # The 11.1 table.
    assert {
        "accounts:list",
        "accounts:lock",
        "accounts:role",
        "allowed_emails:read",
        "allowed_emails:write",
        "profiles:read:any",
        "profiles:write:any",
        "children:read:any",
    } <= permissions.PERMISSIONS


def test_admin_only_is_whatever_a_parent_lacks():
    assert permissions.is_admin_only("accounts:lock")
    assert not permissions.is_admin_only("profiles:read:self")


def test_every_any_permission_with_a_self_variant_is_known():
    for permission in permissions.PERMISSIONS:
        if permission.endswith(":any") and permission.startswith("profiles:"):
            assert permissions.self_variant(permission) in permissions.PERMISSIONS


def test_self_variant():
    assert permissions.self_variant("profiles:write:any") == "profiles:write:self"
    with pytest.raises(ValueError):
        permissions.self_variant("accounts:lock")


def test_check_known():
    assert permissions.check_known("accounts:lock") == "accounts:lock"
    with pytest.raises(ValueError, match="unknown permission"):
        permissions.check_known("accounts:nuke")


def test_roles():
    assert {"parent", "admin"} == permissions.ROLES
