import type { BaseEvent } from "@ag-ui/core";
import type { Health, Manifest, ResumeRequest, RunRecord, RunRequest, RunResult } from "./types.ts";

export class ArcHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`ARC ${path} returned HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "ArcHttpError";
  }
}

export type ArcEvent = BaseEvent & Record<string, unknown>;

/** Minimal fetch-based ARC client used by the playground, eval runner, chat, and conformance. */
export class ArcClient {
  readonly baseUrl: string;
  constructor(
    baseUrl: string,
    private readonly timeoutMs = 120_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new ArcHttpError(res.status, text, path);
    return (text ? JSON.parse(text) : null) as T;
  }

  health = () => this.request<Health>("GET", "/health");
  manifest = () => this.request<Manifest>("GET", "/manifest");
  wait = (req: RunRequest) => this.request<RunResult>("POST", "/runs/wait", req);
  getRun = (runId: string) => this.request<RunRecord>("GET", `/runs/${encodeURIComponent(runId)}`);
  resume = (runId: string, req: Omit<ResumeRequest, "stream">) =>
    this.request<RunResult>("POST", `/runs/${encodeURIComponent(runId)}/resume`, { ...req, stream: false });
  getThread = (threadId: string) =>
    this.request<{ thread_id: string; messages: RunResult["messages"] }>(
      "GET",
      `/threads/${encodeURIComponent(threadId)}`,
    );
  deleteThread = (threadId: string) =>
    this.request<unknown>("DELETE", `/threads/${encodeURIComponent(threadId)}`);

  stream(req: RunRequest, signal?: AbortSignal): AsyncGenerator<ArcEvent> {
    return this.sse("/runs/stream", req, signal);
  }

  resumeStream(
    runId: string,
    req: Omit<ResumeRequest, "stream">,
    signal?: AbortSignal,
  ): AsyncGenerator<ArcEvent> {
    return this.sse(`/runs/${encodeURIComponent(runId)}/resume`, { ...req, stream: true }, signal);
  }

  private async *sse(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<ArcEvent> {
    const res = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok || !res.body) throw new ArcHttpError(res.status, await res.text(), path);
    yield* parseSse(res.body);
  }
}

/** Parses an SSE byte stream into JSON `data:` payloads. Comments and non-data fields are ignored. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ArcEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true }).replaceAll("\r\n", "\n");
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data && data !== "[DONE]") yield JSON.parse(data) as ArcEvent;
      idx = buffer.indexOf("\n\n");
    }
  }
}
