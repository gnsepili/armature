# armature-agents

The `armature` CLI. It compiles an `armature.yaml` spec into a plain Python agent project
(LangGraph or the OpenAI Agents SDK) with a benchmark, a local playground and a handoff kit
for Claude Code and Codex. The generated project does not depend on Armature at runtime.

```bash
npx armature-agents init support-bot --yes --tool lookup_order:read:order_id
cd support-bot && uv sync
npx armature-agents dev --offline
```

Requires Node 22+, and Python 3.12+ with [uv](https://docs.astral.sh/uv/) for the generated
project.

Docs: [CLI reference](https://github.com/gnsepili/armature/blob/main/docs/cli.md) ·
[repository](https://github.com/gnsepili/armature). Apache-2.0.
