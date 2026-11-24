"""The children service: each parent's children, their profiles and journey progress.

docs/auth-users-split.md 12.1; endpoints in docs/auth-users-split-api.md. Every write
publishes one `child.changed` snapshot (7.4), which each circle keeps as its
`child_access` copy; the worker (build plan 4.2) sets the progress flags from the circles'
completion events and purges deleted children after 30 days.
"""
