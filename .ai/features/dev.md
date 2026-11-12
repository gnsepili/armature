# Feature: Dev (`armature dev`)

## What Users Can Do

- Run the generated agent plus the web playground with one command, live or against the offline mock.
- Choose ports and host; skip opening the browser.

## Screens/Routes

CLI command (no UI route)

## Backend APIs Called

Serves `/arc/*` (proxy to the app) and `/__armature/info`. See [arc-http-api](arc-http-api.md).

## Components

`packages/cli/src/commands/dev.ts` (`startPlaygroundServer`), playground assets.

## State Management

Child processes (app, optional mock); no persisted state except the app's session DB.

## Business Rules

- Requires the project venv (exit 5 otherwise).
- Defaults: playground 5174, app 8000, host 127.0.0.1.
- `--offline` sets `ARMATURE_MODEL_MODE=mock`.
- Ctrl-C is a normal shutdown (exit 0); an app crash exits 5.

## User Flow

1. Check venv.
2. Start mock when offline.
3. Spawn `python -m <package> serve`, wait healthy.
4. Start playground server and open the browser.
5. On exit, stop children.

## Navigation Flow

[init](init.md) -> dev -> [playground-ui](playground-ui.md) or [chat](chat.md).

## Related Features

- [playground-ui](playground-ui.md)
- [chat](chat.md)
- [arc-http-api](arc-http-api.md)

## Dependencies

Python venv, uv, optionally a model key.

## Error Scenarios

Port in use or app crash: exit 5. Missing key (live): warning only.

## Performance

Startup dominated by Python import time.

## Modules Involved

- [cli](../modules/cli.md)
- [playground](../modules/playground.md)
- [core](../modules/core.md)
- [mock-llm](../modules/mock-llm.md)
- [arc](../modules/arc.md)

## Patterns Used

- [app-process-launching](../patterns/app-process-launching.md)
- [mock-llm-scripted-testing](../patterns/mock-llm-scripted-testing.md)
- [arc-contract-and-client](../patterns/arc-contract-and-client.md)
