"""Structured output: parse and validate the agent's final answer against the spec's schema."""

from __future__ import annotations

import json
import re
from typing import Any

import jsonschema

from .. import settings as spec

_FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


class OutputInvalid(ValueError):
    pass


def enabled() -> bool:
    return spec.STRUCTURED_OUTPUT_SCHEMA is not None


def instructions() -> str:
    """Appended to the system prompt when the spec declares an output schema."""
    if not enabled():
        return ""
    schema = json.dumps(spec.STRUCTURED_OUTPUT_SCHEMA, indent=2, sort_keys=True)
    return (
        "When you give your final answer, reply with only a JSON value that matches this schema, "
        "with no other text:\n<output_schema>\n" + schema + "\n</output_schema>"
    )


def parse(text: str) -> Any:
    """Returns the final output: the text itself, or the validated JSON value."""
    if not enabled():
        return text
    body = text.strip()
    match = _FENCE.match(body)
    if match:
        body = match.group(1)
    try:
        value = json.loads(body)
    except json.JSONDecodeError as exc:
        raise OutputInvalid(f"the answer is not JSON: {exc.msg}") from exc
    try:
        jsonschema.validate(value, spec.STRUCTURED_OUTPUT_SCHEMA)
    except jsonschema.ValidationError as exc:
        raise OutputInvalid(f"the answer does not match the output schema: {exc.message}") from exc
    return value


def repair_prompt(error: OutputInvalid) -> str:
    return (
        f"Your last answer was rejected: {error}. Reply again with only a JSON value that "
        "matches the output schema, with no other text."
    )
