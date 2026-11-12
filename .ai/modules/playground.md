# Module: playground (`@armature/playground`)

## Purpose & Scope

### What This Module Does

`packages/playground` ships the static web UI that `armature dev` serves: a dependency-free chat page
(`public/index.html`, `public/styles.css`, `public/app.js`) that talks to a generated app through ARC. The only
TypeScript is `src/index.ts`, which resolves where the assets live (`playgroundDir()`).

### Boundaries

- IN: static assets, the asset-directory resolver, the browser-side ARC client (SSE parsing, approvals UI, tool
  timeline, thread list in `localStorage`).
- OUT: the HTTP server that serves it and proxies `/arc/*` (that is `startPlaygroundServer` in `packages/cli`,
  see [cli.md](cli.md)); the ARC contract (see [arc.md](arc.md)); the generated app.
- Not implemented: a websocket transport. The browser uses SSE only.

## Key Components

| Piece | Location | Role |
| --- | --- | --- |
| `playgroundDir()` | `../../packages/playground/src/index.ts:11` | Finds `../public` (source) or `./playground` (bundled `dist/`) |
| Markup | `../../packages/playground/public/index.html` (61 lines) | Shell, composer, thread sidebar |
| Styles | `../../packages/playground/public/styles.css` (738 lines) | Layout and theming |
| App logic | `../../packages/playground/public/app.js` (827 lines) | State, rendering, ARC calls |

Within `app.js`: `API = "/arc"`; `loadInfo` reads `/__armature/info` (`app_url`, `mode`, `framework`, `name`);
`sendMessage` POSTs `/runs/stream`; `consumeStream` and `parseSseBlock` decode server-sent events; approvals are
answered via `/runs/<id>/resume`; threads are persisted in a `localStorage` list.

## API Surface

Export: `playgroundDir(): string` (throws `Armature playground assets not found near <dir>` if neither candidate
holds `index.html`). Browser surface: it requires the playground server to expose `/arc/*` and
`/__armature/info`.

## Dependencies

### Internal Modules

None at runtime. `packages/cli` imports `playgroundDir`; the CLI build copies `public/` to `dist/playground`.

### External Services

The generated app, reached through the CLI's proxy (same origin, so no CORS handling in the page).

### Patterns Used

[arc-contract-and-client](../patterns/arc-contract-and-client.md).

## Data Flow

```
browser -> GET /            -> static file (no-store)
browser -> GET /__armature/info -> {app_url, mode, framework, name}
browser -> POST /arc/runs/stream -> proxy -> app POST /runs/stream (SSE)
browser <- SSE events (text, tool call/result, approval_required, run finished)
browser -> POST /arc/runs/<id>/resume {decisions} -> proxy -> app
```

## Key Behaviors

### Sending a message

1. `sendMessage` appends the user bubble and posts to `/arc/runs/stream` with the thread id.
2. `consumeStream` reads the body incrementally; `parseSseBlock` splits blocks into events.
3. Text deltas extend the assistant bubble; tool events update the tool timeline.
4. An `armature.approval_required` event renders approve/reject controls; the choice is posted to resume, and
   the stream continues.

### Error scenarios

- App unreachable: the server proxy answers 502 JSON; the page shows the error instead of a reply.
- Mode shown from `/__armature/info`: `mock` for `dev --offline`, `live` otherwise.

### Why This Flow

One origin for static files and the API avoids CORS and lets the page be a plain file set with no build step.

## Configuration

None in the package. Port, host and offline mode come from `armature dev` flags.

## Testing

Asset serving, proxying and `/__armature/info` are covered by `../../packages/cli/test/chat-dev.test.ts`. There
are no browser tests for `app.js`; verify UI changes manually via `armature dev --offline`.

## Performance Considerations

Static assets are served with `cache-control: no-store`, so edits show on reload. The stream is consumed
incrementally; the page keeps whole threads in `localStorage`.

## Gotchas & Constraints

### Never Do This

- Never add a bundler or npm dependency to `public/`; the CLI build only copies the files.
- Never call the app directly from the browser; go through `/arc`.

### Always Do This

- Keep `index.html` present in `public/`, since `playgroundDir()` keys on it.

### Common Mistakes

- Editing assets and expecting `dist/playground` to change without `pnpm build`.

### Edge Cases

- Path traversal requests are refused with 403 by the server; unknown paths fall back to `index.html`.

### Business Rules

- Approvals are explicit human decisions in the UI; nothing auto-approves.

## Security Considerations

Served on `127.0.0.1` by default. The proxy only forwards `/arc/*`. No credentials are held in the page.

## Features Implemented

[playground-ui](../features/playground-ui.md), [dev](../features/dev.md).

## Related Documentation

[cli](cli.md), [arc](arc.md), [arc-http-api](../features/arc-http-api.md), `../../docs/cli.md`.
