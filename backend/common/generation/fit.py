"""LLM text that's longer than the schema allows, clipped instead of failing the job.

The schemas the circles send with their prompts (today's, ported) set a `maxLength` on each
text, and the server checks every answer against them. Providers don't enforce `maxLength`,
and today's app stores the answer unchecked, so a plan with one sentence a few characters
over its limit used to show. Failing the whole job (and its retries) for that loses a good
answer (found by the e2e full journey). `clip_to_schema` cuts each over-long string at a
word boundary, with an ellipsis, before the answer is validated; a structural problem
(a missing field, a wrong count, a wrong type) still fails it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

ELLIPSIS = "…"


def clip(text: str, limit: int) -> str:
    """`text` if it fits, else cut at the last space that keeps most of it, plus "…"."""
    if len(text) <= limit:
        return text
    cut = text[: max(limit - len(ELLIPSIS), 0)]
    space = cut.rfind(" ")
    if space >= len(cut) * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:.-–—") + ELLIPSIS


def clip_to_schema(data: Any, schema: Mapping[str, Any]) -> Any:
    """A copy of `data` with every string over its schema's `maxLength` clipped. Follows
    `properties` and `items`; anything that doesn't match the schema's shape is left as it
    is, for the validator to report."""
    if isinstance(data, str):
        limit = schema.get("maxLength")
        return clip(data, limit) if isinstance(limit, int) else data
    if isinstance(data, dict):
        properties = schema.get("properties") or {}
        return {
            key: clip_to_schema(value, properties[key]) if key in properties else value
            for key, value in data.items()
        }
    if isinstance(data, list) and isinstance(schema.get("items"), Mapping):
        return [clip_to_schema(item, schema["items"]) for item in data]
    return data
