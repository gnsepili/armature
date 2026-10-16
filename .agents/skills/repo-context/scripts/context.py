#!/usr/bin/env python3
"""Read-only inventory, change impact and validation for portable .ai context."""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import subprocess
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import unquote

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", ".next",
             "dist", "build", "target", "vendor", ".cache", ".pytest_cache",
             ".tox", ".build", ".gradle", ".superpowers", "coverage", ".ai", ".agents", ".claude", ".codex"}
SKIP_SUFFIXES = {".pyc", ".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov",
                 ".mp3", ".wav", ".m4a", ".aiff", ".flac", ".ogg", ".webm", ".avi",
                 ".gif", ".heic", ".ico", ".ttf", ".otf", ".woff", ".woff2", ".ttc",
                 ".pdf", ".zip", ".sqlite", ".db", ".pem", ".key"}
PHASES = {"0", "1", "1.5", "2", "3", "4"}


def relative(value: str) -> bool:
    return bool(value) and not value.startswith("/") and "\\" not in value and ".." not in PurePosixPath(value).parts


def matches(path: str, pattern: str) -> bool:
    """POSIX fnmatch with **/ also matching zero directories; directories allowed."""
    pattern = pattern.removeprefix("./")
    if pattern in {".", "**", "**/*"}:
        return True
    if path == pattern.rstrip("/") or path.startswith(pattern.rstrip("/") + "/"):
        return True
    if fnmatch.fnmatchcase(path, pattern):
        return True
    if "**/" in pattern:
        return matches(path, pattern.replace("**/", "", 1))
    return False


def hidden_source(path: str) -> bool:
    p = PurePosixPath(path)
    return (bool(set(p.parts[:-1]) & SKIP_DIRS) or p.suffix.lower() in SKIP_SUFFIXES
            or p.name.startswith(".env") or p.name in {".DS_Store", "credentials.json", "secrets.json"})


def excluded(path: str, config: dict) -> bool:
    patterns = config.get("ignore", []) + [e["pattern"] for e in config.get("excluded_sources", [])]
    return hidden_source(path) or any(matches(path, p) for p in patterns)


def files(repo: Path, config: dict) -> list[str]:
    # Git's inventory respects ignore rules and avoids walking local output/cache
    # trees. Include untracked source files so ongoing work is represented too.
    try:
        listing = subprocess.run(["git", "-C", str(repo), "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                                 capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        listing = None
    if listing is not None:
        paths = {p.decode("utf-8", "surrogateescape") for p in listing.stdout.split(b"\0") if p}
        return sorted(p for p in paths if relative(p) and not excluded(p, config)
                      and (repo / p).is_file() and not (repo / p).is_symlink()
                      and (repo / p).resolve().is_relative_to(repo))
    result = []
    for folder, dirs, names in os.walk(repo, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS
                         and not (Path(folder) / d).is_symlink()
                         and not excluded((Path(folder) / d).relative_to(repo).as_posix(), config))
        for name in sorted(names):
            path = Path(folder) / name
            key = path.relative_to(repo).as_posix()
            if not path.is_symlink() and not excluded(key, config):
                result.append(key)
    return sorted(result)


def load_map(repo: Path, required: bool = True) -> dict:
    path = repo / ".ai/context-map.json"
    if not path.exists() and not required:
        return {}
    if not path.resolve().is_relative_to(repo):
        raise ValueError("Context map resolves outside the project")
    config = json.loads(path.read_text())
    if not isinstance(config, dict) or config.get("schema_version") != 1:
        raise ValueError("context-map.json requires schema_version: 1")
    for field in ["documents", "source_roots", "ignore", "excluded_sources"]:
        if not isinstance(config.get(field), list):
            raise ValueError(f"Map requires array: {field}")
    for field in ["source_roots", "ignore"]:
        for value in config[field]:
            if not isinstance(value, str) or not relative(value):
                raise ValueError(f"Invalid relative path/glob in {field}: {value!r}")
    seen = set()
    for doc in config["documents"]:
        if not isinstance(doc, dict):
            raise ValueError("Every document must be an object")
        path = doc.get("path", "")
        if not isinstance(path, str) or not relative(path) or not path.startswith(".ai/") or not path.endswith(".md"):
            raise ValueError(f"Invalid document path: {path!r}")
        if path in seen:
            raise ValueError(f"Duplicate document: {path}")
        seen.add(path)
        for field in ["sources", "related"]:
            values = doc.get(field)
            if not isinstance(values, list) or any(not isinstance(p, str) or not relative(p) for p in values):
                raise ValueError(f"Invalid {field} list in {path}")
        if not doc["sources"] and path not in {".ai/agents.md", ".ai/README.md"}:
            raise ValueError(f"Document needs source evidence: {path}")
    for item in config["excluded_sources"]:
        if (not isinstance(item, dict) or not isinstance(item.get("pattern"), str)
                or not relative(item["pattern"]) or not isinstance(item.get("reason"), str)
                or not item["reason"].strip()):
            raise ValueError("Each excluded source needs a relative pattern and nonempty reason")
    if "bootstrap" in config:
        progress = config["bootstrap"]
        if not isinstance(progress, dict):
            raise ValueError("bootstrap must be an object")
        completed, skipped = progress.get("completed_steps", []), progress.get("skipped_steps", {})
        if (not isinstance(completed, list) or any(not isinstance(p, str) or p not in PHASES for p in completed)
                or len(completed) != len(set(completed)) or not isinstance(skipped, dict)
                or any(p != "1.5" or not isinstance(v, str) or not v.strip() for p, v in skipped.items())
                or set(completed) & set(skipped)):
            raise ValueError("Invalid bootstrap phases or conflicting completed/skipped phases")
        omitted = progress.get("omitted_artifacts", {})
        if not isinstance(omitted, dict) or any(not relative(p) or not p.startswith(".ai/")
                                               or not isinstance(reason, str) or not reason.strip()
                                               for p, reason in omitted.items()):
            raise ValueError("omitted_artifacts needs .ai paths and nonempty reasons")
    return config


def git(repo: Path, *args: str) -> list[str]:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True)
    return [p.decode("utf-8", "surrogateescape") for p in result.stdout.split(b"\0") if p]


def changed(repo: Path, base: str | None) -> list[str]:
    top = subprocess.run(["git", "-C", str(repo), "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True, check=True)
    if Path(top.stdout.strip()).resolve() != repo:
        raise ValueError("Use the Git repository root for impact, or supply --changed paths")
    if base:
        resolved = subprocess.run(["git", "-C", str(repo), "rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}"],
                                  capture_output=True, text=True, check=True).stdout.strip()
        paths = git(repo, "diff", "--name-only", "-z", "--no-renames", resolved, "--")
    else:
        head = subprocess.run(["git", "-C", str(repo), "rev-parse", "--verify", "HEAD"], capture_output=True)
        if head.returncode == 0:
            paths = git(repo, "diff", "--name-only", "-z", "--no-renames", "HEAD", "--")
        else:
            paths = git(repo, "diff", "--cached", "--name-only", "-z", "--no-renames", "--")
            paths += git(repo, "diff", "--name-only", "-z", "--no-renames", "--")
    return sorted(set(paths + git(repo, "ls-files", "--others", "--exclude-standard", "-z")))


def impact(repo: Path, config: dict, paths: list[str]) -> dict:
    docs = {d["path"]: d for d in config["documents"]}
    for path in paths:
        if not relative(path):
            raise ValueError(f"Changed path must be repository-relative: {path!r}")
    sources = sorted(p for p in set(paths) if not excluded(p, config))
    direct = {key: [p for p in sources if any(matches(p, pattern) for pattern in doc["sources"])]
              for key, doc in docs.items()}
    direct = {key: value for key, value in direct.items() if value}
    affected = set(direct)
    # Consider both inbound and outbound dependencies. They are candidates for
    # semantic inspection, not a requirement to touch every reachable document.
    while True:
        more = {key for key, doc in docs.items() if set(doc["related"]) & affected}
        more |= {related for key in affected for related in docs.get(key, {}).get("related", [])}
        if more <= affected:
            break
        affected |= more
    covered = {p for values in direct.values() for p in values}
    return {"changed_sources": sources, "direct": direct,
            "related_candidates": sorted(affected - set(direct)),
            "unmapped_changes": sorted(set(sources) - covered),
            "changed_context": sorted(p for p in paths if p.startswith(".ai/")),
            "note": "Inspect semantic impact. A changed document is not proof that its content is accurate."}


def validate(repo: Path, config: dict) -> dict:
    errors, warnings = [], []
    sources = files(repo, config)
    docs = {d["path"]: d for d in config["documents"]}
    for required in [".ai/agents.md", ".ai/README.md"]:
        if required not in docs:
            errors.append(f"Navigation document not mapped: {required}")
    for key, doc in docs.items():
        path = repo / key
        if not path.resolve().is_relative_to(repo) or path.is_symlink():
            errors.append(f"Document must remain inside repository: {key}")
            continue
        if not path.is_file():
            errors.append(f"Missing document: {key}")
            continue
        body = path.read_text()
        if not body.strip():
            errors.append(f"Empty document: {key}")
        for pattern in doc["sources"]:
            if not any(matches(s, pattern) for s in sources):
                errors.append(f"Source pattern matches no maintained files: {key}: {pattern}")
        for related in doc["related"]:
            if related not in docs:
                errors.append(f"Unmapped related document: {key} -> {related}")
        # Ignore fenced/inline code; validate local inline and reference-style links.
        prose = re.sub(r"^\s*(`{3,}|~{3,}).*?^\s*\1\s*$", "", body, flags=re.M | re.S)
        prose = re.sub(r"`[^`\n]*`", "", prose)
        links = re.findall(r"\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)", prose)
        links += re.findall(r"^\s*\[[^]]+\]:\s*<?([^\s>]+)>?", prose, flags=re.M)
        for raw in links:
            if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", raw) or raw.startswith("#"):
                continue
            target = unquote(raw.split("#", 1)[0].split("?", 1)[0])
            target = re.sub(r":\d+(?:-\d+)?$", "", target)
            if not target:
                continue
            linked = (path.parent / target).resolve()
            if not linked.is_relative_to(repo):
                errors.append(f"Nonportable link outside repository: {key} -> {raw}")
            elif not linked.exists():
                errors.append(f"Broken link: {key} -> {raw}")
    for folder, dirs, names in os.walk(repo / ".ai", followlinks=False):
        dirs[:] = [d for d in dirs if d != "prompts" and not (Path(folder) / d).is_symlink()]
        for name in names:
            if name.endswith(".md"):
                key = (Path(folder) / name).relative_to(repo).as_posix()
                if key not in docs:
                    errors.append(f"Context document not mapped: {key}")
    scoped = [s for s in sources if any(matches(s, r) for r in config["source_roots"])]
    for root in config["source_roots"]:
        if not any(matches(s, root) for s in sources):
            warnings.append(f"Source root has no maintained files: {root}")
    unmapped = [s for s in scoped if not any(matches(s, pattern) for d in docs.values() for pattern in d["sources"])]
    errors.extend(f"Unmapped source: {s}" for s in unmapped)
    if not any(p.startswith(".ai/architecture/") for p in docs):
        errors.append("No architecture document mapped")
    progress = config.get("bootstrap", {})
    recorded = set(progress.get("completed_steps", [])) | set(progress.get("skipped_steps", {}))
    if recorded != PHASES:
        warnings.append("Bootstrap progress incomplete or unrecorded; inspect phase artifacts before completion")
    return {"valid": not errors, "documents": len(docs), "source_files": len(scoped),
            "errors": errors, "warnings": warnings,
            "limits": "Checks structure, file links (not anchors), and mapping coverage; agent review must verify facts and index completeness."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["inventory", "impact", "validate"])
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--base", help="Commit/ref before task changes; includes the current working tree")
    group.add_argument("--changed", nargs="+", help="Explicit repository-relative task paths (including deletions)")
    parser.add_argument("--limit", type=int, default=4000, help="Maximum inventory paths displayed")
    args = parser.parse_args()
    try:
        repo = args.repo.resolve(strict=True)
        if not repo.is_dir():
            raise ValueError("Project root must be a directory")
        config = load_map(repo, required=args.command != "inventory")
        if args.command == "inventory":
            paths = files(repo, config)
            result = {"repo": str(repo), "file_count": len(paths),
                      "files": paths[:max(args.limit, 0)], "truncated": len(paths) > max(args.limit, 0),
                      "extensions_top_30": dict(Counter(Path(p).suffix or "[none]" for p in paths).most_common(30)),
                      "context_map_exists": bool(config),
                      "note": "Inventory is structural; inspect source before inferring frameworks or behavior. Hidden credentials, media, dependencies and build artifacts are omitted."}
        elif args.command == "impact":
            result = impact(repo, config, args.changed if args.changed is not None else changed(repo, args.base))
        else:
            result = validate(repo, config)
        print(json.dumps(result, indent=2))
        return 1 if args.command == "validate" and not result["valid"] else 0
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(json.dumps({"error": str(error), "hint": "For repositories without Git use impact --changed with task paths."}), flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
