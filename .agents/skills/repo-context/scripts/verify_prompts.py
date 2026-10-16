#!/usr/bin/env python3
"""Verify bundled original prompts, optionally against the original source folder."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def verify(skill: Path, source: Path | None = None) -> dict:
    folder = skill / "prompts"
    manifest = json.loads((folder / "manifest.json").read_text())
    expected = manifest["files"]
    actual = {p.name for p in folder.glob("*.md")}
    errors = []
    if actual != set(expected):
        errors.append(f"Prompt set mismatch: missing={sorted(set(expected) - actual)}, extra={sorted(actual - set(expected))}")
    if source is not None:
        source_files = {p.name for p in source.glob("*.md")}
        if source_files != set(expected):
            errors.append(f"Original source set mismatch: missing={sorted(set(expected) - source_files)}, extra={sorted(source_files - set(expected))}")
    total_bytes = 0
    for name, record in expected.items():
        if Path(name).name != name or not name.endswith(".md"):
            raise ValueError(f"Invalid manifest filename: {name}")
        path = folder / name
        if not path.is_file():
            continue
        data = path.read_bytes()
        total_bytes += len(data)
        if hashlib.sha256(data).hexdigest() != record["sha256"]:
            errors.append(f"Checksum mismatch: {name}")
        if len(data) != record["bytes"]:
            errors.append(f"Byte count mismatch: {name}")
        if source is not None:
            original = source / name
            if not original.is_file() or original.read_bytes() != data:
                errors.append(f"Original content differs: {name}")
    return {"valid": not errors, "prompt_files": len(expected), "total_bytes": total_bytes,
            "source_comparison": source is not None, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Optional original .ai/prompts folder for exact comparison")
    args = parser.parse_args()
    try:
        result = verify(Path(__file__).resolve().parents[1], args.source)
        print(json.dumps(result, indent=2))
        return 0 if result["valid"] else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"valid": False, "error": str(error)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
