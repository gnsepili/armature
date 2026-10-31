# CLI reference

```bash
npm i -g armature-agents   # or: npx armature-agents <command>
```

Every command works without a terminal. Add `--json` for machine-readable output and branch
on the exit code. The contract is recorded in [ADR 0003](adr/0003-cli-surface-v0.md).

| Exit | Meaning                                                                    |
| ---- | -------------------------------------------------------------------------- |
| 0    | ok                                                                         |
| 1    | validation: bad spec, flag or option                                       |
| 2    | unsupported: planned framework/pattern, or an uncatalogued model           |
| 3    | overwrite refused: existing `armature.yaml` or non-empty dir, no `--force` |
| 4    | eval gate failed                                                           |
| 5    | environment: no `.venv`, app not reachable                                 |

## `armature init [dir]`

Creates `armature.yaml` and generates the project. In a terminal it runs a short wizard
(intent, stack, model, tools, a compile preview). `--yes`, `--config` or `--json` skips it.

```bash
armature init support-bot --yes \
  --framework openai-agents \
  --tool lookup_order:read:order_id \
  --tool issue_refund:write:order_id,amount \
  --with memory:sqlite
```

| Flag                                                           | Notes                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `--name`, `--description`                                      | `name` is a slug; default comes from the directory                                           |
| `--framework`                                                  | `langgraph` (default) or `openai-agents`                                                     |
| `--pattern`                                                    | `single_agent_tools`                                                                         |
| `--provider`, `--model`                                        | `openai`, `anthropic`, `openai_compatible`; default model is the provider's first suggestion |
| `--base-url`                                                   | required for `openai_compatible`                                                             |
| `--with <token>`                                               | `memory`, `memory:sqlite`, `no-memory` (repeatable)                                          |
| `--tool name:side_effect:args`                                 | side effect `none`, `read`, `write`, `destructive` (repeatable)                              |
| `--assistant`                                                  | `claude`, `codex`, `generic`, `both` (repeatable)                                            |
| `--config <file>`                                              | partial spec in YAML or JSON; `-` reads stdin; flags override it                             |
| `--dry-run`, `--force`, `--experimental`, `--json`, `-o <dir>` |                                                                                              |

Write and destructive tools require approval unless the spec's `policies.approvals` says
otherwise. Models outside `models.json` need `--experimental`.

## `armature generate [dir]`

Re-renders the project from `armature.yaml`. Managed files are updated only if you have not
edited them; edited ones are reported as `kept (edited)`. `--force` replaces edited managed
files but never touches files you own (tools, prompts). Managed files that are no longer
produced are removed if unedited. `--dry-run` shows the changes, `--verbose` lists unchanged
files, `--spec <file>` reads another spec.

## `armature sync [dir]`

Refreshes only the coding-agent handoff from `armature.yaml`: `AGENTS.md`, `CLAUDE.md`,
`docs/`, `.agents/skills/`, the `.claude/skills/` copies and the docs MCP config (`.mcp.json`,
`.codex/config.toml`). Runtime code, tools, tests and evals are untouched. Run it after editing a
skill in `.agents/skills/` so Claude Code's copy matches, or after changing
`assistant.targets`. Same flags and edit rules as `generate`; needs an existing
`armature.lock`. See [ADR 0004](adr/0004-handoff-kit-and-sync.md).

## `armature plan [dir]`

Explains what `generate` would build: stack, model and price, approvals, limits, tools, the
file changes, the pinned Python packages, the secrets it needs, and what is left to implement.
Writes nothing. `--json` returns `{plan, compat, files, counts, secrets, tasks}`.

## `armature dev [dir]`

Runs the app from `.venv` (`uv sync` first) and the web playground.

```bash
armature dev --offline      # mock model, no API key
armature dev                # live model; needs the provider's API key in the environment
```

The playground is at `http://127.0.0.1:5174` and proxies `/arc/*` to the app on port 8000.
`--port`, `--app-port`, `--host` and `--no-open` change the defaults.

## `armature chat`

```bash
armature chat                          # interactive; /new starts a thread, /exit quits
armature chat -m "where is order 42?"  # one message, streamed
armature chat -m "..." --json          # the finished ARC run as JSON
```

`--url` (default `http://127.0.0.1:8000`) and `--thread <id>`. In a terminal, tools that need
approval are confirmed inline; elsewhere the paused run is reported and can be approved in the
playground.
