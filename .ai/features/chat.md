# Feature: Chat (`armature chat`)

## What Users Can Do

- Talk to a running agent from the terminal, with approval prompts for gated tools.
- Send one message non-interactively with `--message` (and `--json`).

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

ARC `/runs/stream`, `/runs/{id}/resume` ([arc-http-api](arc-http-api.md)).

## Components

`packages/cli/src/commands/chat.ts` (`printStream`).

## State Management

In-memory thread id; `/new` starts another.

## Business Rules

- `--json` requires `--message`.
- REPL commands: `/new`, `/exit` (alias `/quit`).
- `armature.approval_required` is answered per approval.

## User Flow

1. Check the URL is reachable (hint `armature dev`).
2. Stream events and print text and tool activity.
3. On approval, ask the user and resume.

## Navigation Flow

[dev](dev.md) -> chat.

## Related Features

- [dev](dev.md)
- [arc-http-api](arc-http-api.md)

## Dependencies

A running app.

## Error Scenarios

Unreachable URL: failure with a hint to run `armature dev`.

## Performance

Streaming.

## Modules Involved

- [cli](../modules/cli.md)
- [arc](../modules/arc.md)

## Patterns Used

- [arc-contract-and-client](../patterns/arc-contract-and-client.md)
- [io-abstraction-testable-cli](../patterns/io-abstraction-testable-cli.md)
