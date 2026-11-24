"""The role → permission table (docs/auth-users-split.md, 11.2).

Routes never name a role: they ask for a permission (`require("accounts:lock")`), and this
table says which roles hold it. Changing what a role may do means editing this table only.

- `…:self` permissions cover the caller's own data. `require_self_or("profiles:read:any")`
  lets the owner through with `profiles:read:self`, and anyone else only with `…:any`.
- Everything a parent doesn't hold is admin-only. Using it is a privileged action, and the
  permission check writes it to the audit trail (11.3).
"""

SELF_PERMISSIONS: frozenset[str] = frozenset(
    {
        "profiles:read:self",
        "profiles:write:self",
    }
)

ADMIN_PERMISSIONS: frozenset[str] = frozenset(
    {
        "accounts:list",
        "accounts:lock",
        "accounts:role",
        "allowed_emails:read",
        "allowed_emails:write",
        "profiles:read:any",
        "profiles:write:any",
        "children:read:any",
    }
)

PERMISSIONS: frozenset[str] = SELF_PERMISSIONS | ADMIN_PERMISSIONS

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "parent": SELF_PERMISSIONS,
    "admin": PERMISSIONS,
}

ROLES: frozenset[str] = frozenset(ROLE_PERMISSIONS)


def permissions_for(role: str) -> frozenset[str]:
    """What `role` may do. An unknown role may do nothing (deny by default)."""
    return ROLE_PERMISSIONS.get(role, frozenset())


def is_admin_only(permission: str) -> bool:
    """True when a parent doesn't hold `permission`, so using it is privileged (11.3)."""
    return permission not in ROLE_PERMISSIONS["parent"]


def self_variant(permission: str) -> str:
    """`profiles:read:any` → `profiles:read:self`: what an owner needs for their own data."""
    if not permission.endswith(":any"):
        raise ValueError(f"{permission!r} isn't an …:any permission")
    return permission.removesuffix(":any") + ":self"


def check_known(permission: str) -> str:
    """Return `permission`, or raise ValueError for a name not in the table (a typo in a route)."""
    if permission not in PERMISSIONS:
        raise ValueError(f"unknown permission {permission!r}; add it to common.permissions")
    return permission
