# Security policy

## Supported versions

Armature is in alpha. Security fixes land on the latest `0.x` release only.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/gnsepili/armature/security/advisories/new).

Include what you found, how to reproduce it, and the impact you expect. You should get a reply
within a few days. Once a fix is released we will credit you in the advisory, unless you prefer
not to be named.

## Scope

In scope:

- the `armature-agents` CLI and its bundled templates;
- code Armature generates (the ARC server, runtime helpers, CI workflow, handoff kit), for
  example a generated server that exposes more than it should, or a template that leaks secrets
  into logs, run records or eval snapshots.

Out of scope:

- the security of tools you implement in a generated project, and of the model provider you
  connect it to;
- the upstream frameworks (LangGraph, OpenAI Agents SDK); report those to their maintainers.

The generated server binds to `127.0.0.1` by default and is meant for local development and
evals. Putting it on a network, and adding authentication in front of it, is your decision.
