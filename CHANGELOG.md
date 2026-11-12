# Changelog

All notable changes to `armature-agents` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may change public
contracts; every such change has an [ADR](docs/adr/).

## [Unreleased]

## 0.1.0 (not yet published)

First public alpha.

### Added

- `armature init`: wizard or flags → `armature.yaml` and a generated Python project.
- `armature generate`, `plan` and `sync`: regenerate managed files, inspect the plan, and
  refresh the coding-agent handoff kit without touching code you own.
- Frameworks: LangGraph (`create_agent` with human-in-the-loop middleware) and the OpenAI
  Agents SDK, for the `single_agent_tools` pattern.
- Providers: OpenAI, Anthropic and OpenAI-compatible endpoints; in-memory or SQLite session
  memory; approvals for write and destructive tools; structured output.
- ARC v1, one HTTP runtime contract for every framework, with a conformance suite.
- `armature dev` and `chat`: local web playground and terminal chat, offline on a scripted mock
  model or live.
- `armature eval plan | validate | run | report | compare | freeze`: seed benchmark, static lint
  for weak graders and leakage, trials with bootstrap intervals, run snapshots and comparison,
  freeze detection, `--max-cost` for live runs.
- `armature doctor` (with opt-in `--probe` and `--conformance`) and `armature test` (golden
  scaffold, generated unit tests, ARC conformance).
- Handoff kit: `AGENTS.md`, `CLAUDE.md`, docs, and build-agent, add-tool, build-benchmark,
  optimize-agent and debug-run skills for Claude Code and Codex.
- A generated GitHub Actions workflow that runs `armature test` and the offline smoke suite.
