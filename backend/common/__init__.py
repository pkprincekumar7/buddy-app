"""Protocol layer shared by every backend service (docs/auth-users-split.md, section 2).

Only code that must behave the same in every service belongs here: token and authz
checks, the event protocol, internal calls, telemetry and logging conventions. Code used
by one service lives in that service.

Versioned with semantic versioning. Changes are backward-compatible only: a breaking
change is a new function next to the old one until every service has moved, and then a
major version bump.
"""

__version__ = "0.13.0"
