"""The transform service: each child's Life Pathway and 90-day plan with its tracker.

docs/auth-users-split.md 8 and 12.1; endpoints in docs/auth-users-split-api.md. The Life
Pathway's milestones (one set per completed growth area), the 90-day plan and its event
tracker are jobs the worker runs from transform's own copies; the parent's work on the
plan is saved with PATCH. The plan generated and the Day-90 event set makes Transform done,
which unlocks Release.
"""
