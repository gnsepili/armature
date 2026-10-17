import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { synthesize } from "./synthesize.ts";
import type {
  ChatMessage,
  ChatRequest,
  ChatToolCall,
  JsonSchema,
  LoggedRequest,
  MockMode,
  Script,
  ScriptStep,
} from "./types.ts";

/** Marker the generated runtime uses to tell any model (and this mock) the required output schema. */
const OUTPUT_SCHEMA = /<output_schema>([\s\S]*?)<\/output_schema>/;
export const NULL_AGENT_REPLY = "I can't help with that.";
const LOG_LIMIT = 500;

export interface MockLlmOptions {
  port?: number;
  host?: string;
  mode?: MockMode;
  scripts?: Script[];
}

export interface MockLlm {
  url: string;
  /** Base URL to give OpenAI-compatible clients (ends in /v1). */
  baseUrl: string;
  server: Server;
  setMode(mode: MockMode): void;
  addScripts(scripts: Script[]): void;
  clearScripts(): void;
  log(): LoggedRequest[];
  clearLog(): void;
  close(): Promise<void>;
}

type Reply = { kind: "text"; text: string } | { kind: "tools"; calls: ChatToolCall[] } | ScriptError;
type ScriptError = { kind: "error"; status: number; message: string };

export function textOf(message: ChatMessage | undefined): string {
  if (!message?.content) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => part.text ?? "").join("");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createMockLlm(options: MockLlmOptions = {}): MockLlm {
  let mode: MockMode = options.mode ?? "smoke";
  const scripts = new Map<string, Script>();
  const requests: LoggedRequest[] = [];
  let callSeq = 0;
  for (const s of options.scripts ?? []) scripts.set(s.match, s);

  const nextCallId = () => `call_mock_${++callSeq}`;

  function decide(req: ChatRequest): {
    reply: Reply;
    served: LoggedRequest["served"];
    step?: number;
    delay?: number;
  } {
    const firstUser = req.messages.find((m) => m.role === "user");
    const script = firstUser ? scripts.get(textOf(firstUser).trim()) : undefined;
    if (script) {
      const step = req.messages.filter((m) => m.role === "assistant").length;
      return {
        reply: fromStep(script.steps[step], nextCallId),
        served: "script",
        step,
        delay: script.delay_ms,
      };
    }
    if (mode === "null") return { reply: { kind: "text", text: NULL_AGENT_REPLY }, served: "null" };
    return { reply: smoke(req, nextCallId), served: "smoke" };
  }

  async function handleChat(req: ChatRequest, res: ServerResponse) {
    const { reply, served, step, delay } = decide(req);
    requests.push({
      at: Date.now(),
      model: req.model,
      stream: Boolean(req.stream),
      messages: req.messages,
      tools: (req.tools ?? []).map((t) => t.function.name),
      served,
      step,
    });
    if (requests.length > LOG_LIMIT) requests.splice(0, requests.length - LOG_LIMIT);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (reply.kind === "error") {
      return sendJson(res, reply.status, { error: { message: reply.message, type: "mock_error" } });
    }
    const promptText = req.messages.map((m) => textOf(m) + JSON.stringify(m.tool_calls ?? "")).join("\n");
    const completionText = reply.kind === "text" ? reply.text : JSON.stringify(reply.calls);
    const usage = {
      prompt_tokens: estimateTokens(promptText),
      completion_tokens: estimateTokens(completionText),
      total_tokens: 0,
    };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    const id = `chatcmpl-mock-${requests.length}`;
    const created = Math.floor(Date.now() / 1000);
    if (req.stream) return streamReply(res, { id, created, model: req.model, reply, usage, req });
    const message =
      reply.kind === "text"
        ? { role: "assistant", content: reply.text }
        : { role: "assistant", content: null, tool_calls: reply.calls };
    sendJson(res, 200, {
      id,
      object: "chat.completion",
      created,
      model: req.model,
      choices: [{ index: 0, message, finish_reason: reply.kind === "text" ? "stop" : "tool_calls" }],
      usage,
    });
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://mock");
      const path = url.pathname.replace(/\/+$/, "");
      if (req.method === "GET" && (path === "/health" || path === ""))
        return sendJson(res, 200, { ok: true, mode });
      if (req.method === "GET" && path.endsWith("/models")) {
        return sendJson(res, 200, {
          object: "list",
          data: [{ id: "mock-model", object: "model", owned_by: "armature" }],
        });
      }
      if (req.method === "POST" && path.endsWith("/chat/completions")) {
        return await handleChat((await readJson(req)) as ChatRequest, res);
      }
      if (path === "/__mock/scripts") {
        if (req.method === "DELETE") {
          scripts.clear();
          return sendJson(res, 200, { ok: true });
        }
        if (req.method === "POST") {
          const body = (await readJson(req)) as Script | { scripts: Script[] };
          const list = "scripts" in body ? body.scripts : [body];
          for (const s of list) scripts.set(s.match.trim(), s);
          return sendJson(res, 201, { ok: true, count: scripts.size });
        }
      }
      if (path === "/__mock/mode" && req.method === "PUT") {
        const body = (await readJson(req)) as { mode: MockMode };
        if (body.mode !== "smoke" && body.mode !== "null")
          return sendJson(res, 400, { error: "mode must be smoke or null" });
        mode = body.mode;
        return sendJson(res, 200, { ok: true, mode });
      }
      if (path === "/__mock/log") {
        if (req.method === "DELETE") {
          requests.length = 0;
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 200, { requests });
      }
      sendJson(res, 404, { error: { message: `mock-llm has no route ${req.method} ${path}` } });
    } catch (err) {
      sendJson(res, 400, { error: { message: (err as Error).message } });
    }
  });

  return {
    url: "",
    baseUrl: "",
    server,
    setMode: (m) => {
      mode = m;
    },
    addScripts: (list) => {
      for (const s of list) scripts.set(s.match.trim(), s);
    },
    clearScripts: () => scripts.clear(),
    log: () => requests,
    clearLog: () => {
      requests.length = 0;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Starts the mock on a port (0 = any free port) and resolves once it is listening. */
export async function startMockLlm(options: MockLlmOptions = {}): Promise<MockLlm> {
  const mock = createMockLlm(options);
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    mock.server.once("error", reject);
    mock.server.listen(options.port ?? 0, host, () => resolve());
  });
  const { port } = mock.server.address() as AddressInfo;
  mock.url = `http://${host}:${port}`;
  mock.baseUrl = `${mock.url}/v1`;
  return mock;
}

function fromStep(step: ScriptStep | undefined, nextId: () => string): Reply {
  if (!step) return { kind: "text", text: "[mock] script exhausted" };
  if ("error" in step) return { kind: "error", status: step.error.status, message: step.error.message };
  if ("text" in step) return { kind: "text", text: step.text };
  return {
    kind: "tools",
    calls: step.tool_calls.map((c) => ({
      id: c.id ?? nextId(),
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
    })),
  };
}

/**
 * Smoke heuristic: call the tool named in the request (or the first tool) once with
 * schema-derived arguments, then summarize the tool result. Never a quality signal.
 */
export function smoke(req: ChatRequest, nextId: () => string): Reply {
  const messages = req.messages;
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }
  const sinceUser = messages.slice(lastUser + 1);
  const toolResults = sinceUser.filter((m) => m.role === "tool");
  const userText = textOf(messages[lastUser]);
  const tools = req.tools ?? [];

  if (toolResults.length === 0 && tools.length > 0 && !sinceUser.some((m) => m.tool_calls?.length)) {
    const lowered = userText.toLowerCase();
    const named = tools.find((t) => {
      const n = t.function.name.toLowerCase();
      return lowered.includes(n) || lowered.includes(n.replaceAll("_", " "));
    });
    const tool = named ?? tools[0]!;
    const args = synthesize(tool.function.parameters ?? { type: "object", properties: {} });
    return {
      kind: "tools",
      calls: [
        {
          id: nextId(),
          type: "function",
          function: { name: tool.function.name, arguments: JSON.stringify(args) },
        },
      ],
    };
  }

  const schema = outputSchema(req);
  if (schema) return { kind: "text", text: JSON.stringify(synthesize(schema)) };

  if (toolResults.length > 0) {
    const last = toolResults[toolResults.length - 1]!;
    const call = sinceUser.flatMap((m) => m.tool_calls ?? []).find((c) => c.id === last.tool_call_id);
    const content = textOf(last).replace(/\s+/g, " ").slice(0, 200);
    return { kind: "text", text: `Mock response: ${call?.function.name ?? "the tool"} returned ${content}` };
  }
  const turns = messages.filter((m) => m.role === "user").length;
  return { kind: "text", text: `Mock response (turn ${turns}): ${userText.slice(0, 200)}` };
}

function outputSchema(req: ChatRequest): JsonSchema | undefined {
  const fromFormat = req.response_format?.json_schema?.schema;
  if (fromFormat) return fromFormat;
  for (const m of req.messages) {
    if (m.role !== "system" && m.role !== "developer") continue;
    const match = OUTPUT_SCHEMA.exec(textOf(m));
    if (match) {
      try {
        return JSON.parse(match[1]!) as JsonSchema;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function streamReply(
  res: ServerResponse,
  ctx: {
    id: string;
    created: number;
    model: string;
    reply: Exclude<Reply, ScriptError>;
    usage: Record<string, number>;
    req: ChatRequest;
  },
) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const base = { id: ctx.id, object: "chat.completion.chunk", created: ctx.created, model: ctx.model };
  const send = (choices: unknown[], extra: Record<string, unknown> = {}) =>
    res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);

  send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
  if (ctx.reply.kind === "text") {
    for (const piece of ctx.reply.text.match(/\S+\s*|\s+/g) ?? []) {
      send([{ index: 0, delta: { content: piece }, finish_reason: null }]);
    }
    send([{ index: 0, delta: {}, finish_reason: "stop" }]);
  } else {
    ctx.reply.calls.forEach((call, index) => {
      send([
        {
          index: 0,
          delta: {
            tool_calls: [
              { index, id: call.id, type: "function", function: { name: call.function.name, arguments: "" } },
            ],
          },
          finish_reason: null,
        },
      ]);
      send([
        {
          index: 0,
          delta: { tool_calls: [{ index, function: { arguments: call.function.arguments } }] },
          finish_reason: null,
        },
      ]);
    });
    send([{ index: 0, delta: {}, finish_reason: "tool_calls" }]);
  }
  if (ctx.req.stream_options?.include_usage) send([], { usage: ctx.usage });
  res.end("data: [DONE]\n\n");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
