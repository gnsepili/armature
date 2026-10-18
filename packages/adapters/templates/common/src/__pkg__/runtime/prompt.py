"""Builds the system prompt from prompts/system.md plus the managed output instructions."""

from __future__ import annotations

from pathlib import Path

from . import output

PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / "system.md"


def system_prompt() -> str:
    text = PROMPT_FILE.read_text(encoding="utf-8").strip() if PROMPT_FILE.is_file() else ""
    extra = output.instructions()
    return f"{text}\n\n{extra}".strip() if extra else text
