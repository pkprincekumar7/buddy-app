"""The users service: each account's profile (names and address) and app preferences.

docs/auth-users-split.md 5.3; endpoints in docs/auth-users-split-api.md. Auth creates the
profile in the registration saga (`PUT /internal/users/{id}`), and the worker deletes it
on `user.deletion_requested`, confirming with `user.data_deleted` (10.3).
"""
