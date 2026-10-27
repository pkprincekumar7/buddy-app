"""Who takes part in account deletion (docs/auth-users-split.md, 10.3).

auth's `deletions.expected` is `PARTICIPANTS`: every service that holds user data deletes it
on `user.deletion_requested`, writes a `user:` tombstone and confirms with
`user.data_deleted`. auth deletes the credentials only when all of them have confirmed.

A service missing from this list would keep a deleted user's data with nothing noticing,
so a test checks every backend service is either here or in `NOT_PARTICIPANTS` with a
reason, and that the event catalogue agrees.
"""

PARTICIPANTS: tuple[str, ...] = (
    "users",
    "children",
    "onboarding",
    "discover",
    "grow",
    "transform",
    "release",
)

# Services with no user data of their own to delete, and why.
NOT_PARTICIPANTS: dict[str, str] = {
    "auth": "runs the deletion and deletes the credentials last (10.3)",
    "shared": "no database: speech-to-text and the APK link only (13.3)",
    "hello": "the build placeholder (build plan 0.4), removed in 8.6",
}
