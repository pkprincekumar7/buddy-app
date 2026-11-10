"""The grow service: each child's growth areas, with their generated questions, rounds and
recommendations.

docs/auth-users-split.md 8 and 12.1; endpoints in docs/auth-users-split-api.md. The parent
works through an area (`PUT …/growth-areas/{area_id}`), and each of its AI parts is a job
the worker runs from grow's own copies (`POST …/generation` with a `kind`). Completing the
first area makes Grow done, which unlocks Transform.
"""
