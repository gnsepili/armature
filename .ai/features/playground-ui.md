# Feature: Playground UI

## What Users Can Do

- Chat with the agent in a browser, see tool calls in a timeline, approve or reject gated tools, switch threads.

## Screens/Routes

`/` (single page; static fallback for unknown paths)

## Backend APIs Called

Via the dev proxy: `/arc/runs/stream`, `/arc/runs/<id>/resume`, `/__armature/info`.

## Components

`packages/playground/public/{index.html,styles.css,app.js}`.

## State Management

In-page state; thread list in `localStorage`.

## Business Rules

- Same-origin only; never call the app directly.
- SSE only (no websocket).

## User Flow

1. Load `/__armature/info`.
2. Send message, stream events.
3. Approve or reject; stream continues.

## Navigation Flow

[dev](dev.md) opens the page; thread sidebar switches conversations.

## Related Features

- [dev](dev.md)
- [arc-http-api](arc-http-api.md)

## Dependencies

The dev server.

## Error Scenarios

502 JSON from the proxy when the app is down.

## Performance

Incremental stream rendering.

## Modules Involved

- [playground](../modules/playground.md)
- [cli](../modules/cli.md)
- [arc](../modules/arc.md)

## Patterns Used

- [arc-contract-and-client](../patterns/arc-contract-and-client.md)
