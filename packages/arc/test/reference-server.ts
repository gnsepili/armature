/**
 * A deliberately small ARC v1 reference implementation in TypeScript. It drives the
 * mock LLM through Chat Completions and exists to prove the conformance suite; the
 * generated Python apps are the real implementations.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

type Msg = { role: string; content: string | null; tool_calls?: Call[]; tool_call_id?: string };
type Call = { id: string; type: "function"; function: { name: string; arguments: string } };
type Emit = (event: Record<string, unknown>) => void;

const TOOLS = [
  {
    name: "lookup_item",
    description: "Look up an item by id.",
    side_effect: "read",
    requires_approval: false,
  },
  { name: "save_note", description: "Save a note.", side_effect: "write", requires_approval: true },
].map((t) => ({
  ...t,
  input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
}));
const LIMITS = { max_steps: 4, max_tool_calls: 6, max_tokens: 100_000, max_cost_usd: 1, timeout_s: 30 };

interface Run {
  id: string;
  thread: string;
  messages: Msg[];
  record: Record<string, any>;
  pending: Call[];
  stubs?: Record<string, { result?: unknown }>;
}

export async function startReferenceServer(opts: { mockBaseUrl: string; evalMode: boolean }) {
  const runs = new Map<string, Run>();
  const threads = new Map<string, Msg[]>();
  const now = () => Date.now();

  async function loop(run: Run, emit: Emit) {
    const rec = run.record;
    const root = rec.spans[0];
    for (;;) {
      if (rec.usage.model_calls >= LIMITS.max_steps)
        return fail(run, emit, "limit_exceeded", "max_steps reached");
      const span = {
        span_id: randomUUID(),
        parent_id: root.span_id,
        name: "chat mock-model",
        operation: "chat",
        start_ms: now(),
        end_ms: null as number | null,
        status: "ok",
        attributes: {},
      };
      rec.spans.push(span);
      const res = await fetch(`${opts.mockBaseUrl}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({
          model: "mock-model",
          messages: run.messages,
          tools: TOOLS.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          })),
        }),
      });
      span.end_ms = now();
      if (!res.ok) return fail(run, emit, "model_error", `model returned ${res.status}`);
      const body = (await res.json()) as any;
      const msg = body.choices[0].message as Msg;
      rec.usage.model_calls++;
      rec.usage.input_tokens += body.usage.prompt_tokens;
      rec.usage.output_tokens += body.usage.completion_tokens;
      rec.usage.total_tokens += body.usage.total_tokens;
      emit({
        type: "CUSTOM",
        name: "armature.usage",
        value: {
          model: "mock-model",
          input_tokens: body.usage.prompt_tokens,
          output_tokens: body.usage.completion_tokens,
          cost_usd: 0,
        },
      });
      run.messages.push(msg);
      if (!msg.tool_calls?.length) {
        const messageId = randomUUID();
        emit({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: msg.content ?? "" });
        emit({ type: "TEXT_MESSAGE_END", messageId });
        rec.output = msg.content;
        return finish(run, emit);
      }
      for (const c of msg.tool_calls) {
        emit({ type: "TOOL_CALL_START", toolCallId: c.id, toolCallName: c.function.name });
        emit({ type: "TOOL_CALL_ARGS", toolCallId: c.id, delta: c.function.arguments });
        emit({ type: "TOOL_CALL_END", toolCallId: c.id });
        const tool = TOOLS.find((t) => t.name === c.function.name)!;
        rec.tool_calls.push({
          id: c.id,
          name: c.function.name,
          args: JSON.parse(c.function.arguments),
          side_effect: tool.side_effect,
          status: tool.requires_approval ? "pending_approval" : "completed",
          approval: tool.requires_approval ? "pending" : "not_required",
        });
        if (tool.requires_approval) run.pending.push(c);
      }
      if (run.pending.length) {
        rec.status = "interrupted";
        rec.pending_approvals = run.pending.map((c) => ({
          tool_call_id: c.id,
          name: c.function.name,
          args: JSON.parse(c.function.arguments),
          side_effect: "write",
        }));
        emit({
          type: "CUSTOM",
          name: "armature.approval_required",
          value: { run_id: run.id, approvals: rec.pending_approvals },
        });
        emit({
          type: "RUN_FINISHED",
          threadId: run.thread,
          runId: run.id,
          outcome: {
            type: "interrupt",
            interrupts: run.pending.map((c) => ({ id: c.id, reason: "tool_approval", toolCallId: c.id })),
          },
        });
        return;
      }
      for (const c of msg.tool_calls) if (!(await execute(run, c, emit))) return;
    }
  }

  async function execute(run: Run, call: Call, emit: Emit, denied = false) {
    const rec = run.record;
    if (
      rec.tool_calls.filter((c: any) => c.status !== "pending_approval" && c.status !== "denied").length >
      LIMITS.max_tool_calls
    ) {
      fail(run, emit, "limit_exceeded", "max_tool_calls reached");
      return false;
    }
    const entry = rec.tool_calls.find((c: any) => c.id === call.id);
    const content = denied
      ? "Denied by the user. Do not retry."
      : JSON.stringify(run.stubs?.[call.function.name]?.result ?? { echo: call.function.arguments });
    if (!denied)
      rec.spans.push({
        span_id: randomUUID(),
        parent_id: rec.spans[0].span_id,
        name: `execute_tool ${call.function.name}`,
        operation: "execute_tool",
        start_ms: now(),
        end_ms: now(),
        status: "ok",
        attributes: {},
      });
    entry.result = denied ? undefined : content;
    run.messages.push({ role: "tool", tool_call_id: call.id, content });
    emit({ type: "TOOL_CALL_RESULT", messageId: randomUUID(), toolCallId: call.id, content, role: "tool" });
    return true;
  }

  function fail(run: Run, emit: Emit, code: string, message: string) {
    Object.assign(run.record, { status: "error", error: { code, message } });
    emit({ type: "RUN_ERROR", message, code });
  }
  function finish(run: Run, emit: Emit) {
    Object.assign(run.record, { status: "success", pending_approvals: [] });
    threads.set(run.thread, run.messages);
    emit({ type: "RUN_FINISHED", threadId: run.thread, runId: run.id, outcome: { type: "success" } });
  }

  function result(run: Run) {
    const { spans, approvals, duration_ms, ...rest } = run.record;
    return {
      ...rest,
      messages: run.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          ...m,
          content: m.content ?? "",
          tool_calls: m.tool_calls?.map((c) => ({
            id: c.id,
            name: c.function.name,
            args: JSON.parse(c.function.arguments),
          })),
        })),
    };
  }

  const server: Server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const path = (req.url ?? "/").split("?")[0]!;
    const respond = async (run: Run, stream: boolean, work: (emit: Emit) => Promise<void>) => {
      if (!stream) {
        await work(() => {});
        return send(200, result(run));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const emit: Emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      emit({ type: "RUN_STARTED", threadId: run.thread, runId: run.id });
      await work(emit);
      res.end();
    };

    if (path === "/health")
      return send(200, {
        status: "ok",
        arc_version: 1,
        framework: "reference",
        eval_mode: opts.evalMode,
        model_mode: "mock",
        ready: {},
      });
    if (path === "/manifest")
      return send(200, {
        arc_version: 1,
        name: "reference",
        framework: "reference",
        pattern: "single_agent_tools",
        model: { provider: "mock", id: "mock-model" },
        tools: TOOLS,
        limits: LIMITS,
        capabilities: {
          session_memory: true,
          streaming: true,
          approvals: true,
          edited_args: false,
          structured_output: { enabled: false },
        },
      });
    if (req.method === "POST" && (path === "/runs/wait" || path === "/runs/stream")) {
      if (body.metadata?.eval && !opts.evalMode)
        return send(400, { detail: "eval metadata is only accepted in eval mode" });
      const thread = body.thread_id ?? randomUUID();
      const history = threads.get(thread) ?? [{ role: "system", content: "You are a reference agent." }];
      const id = randomUUID();
      const run: Run = {
        id,
        thread,
        pending: [],
        stubs: body.metadata?.eval?.stubs,
        messages: [...history, { role: "user", content: String(body.input) }],
        record: {
          run_id: id,
          thread_id: thread,
          status: "success",
          output: null,
          tool_calls: [],
          pending_approvals: [],
          error: null,
          approvals: [],
          duration_ms: null,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, model_calls: 0, cost_usd: 0 },
          spans: [
            {
              span_id: randomUUID(),
              parent_id: null,
              name: "invoke_agent reference",
              operation: "invoke_agent",
              start_ms: now(),
              end_ms: null,
              status: "ok",
              attributes: {},
            },
          ],
        },
      };
      runs.set(id, run);
      return respond(run, path.endsWith("stream"), (emit) => loop(run, emit));
    }
    const resume = /^\/runs\/([^/]+)\/resume$/.exec(path);
    if (resume && req.method === "POST") {
      const run = runs.get(resume[1]!);
      if (!run?.pending.length) return send(404, { detail: "no paused run" });
      return respond(run, Boolean(body.stream), async (emit) => {
        const pending = run.pending;
        run.pending = [];
        run.record.pending_approvals = [];
        for (const call of pending) {
          const d = body.decisions.find((x: any) => x.tool_call_id === call.id);
          const entry = run.record.tool_calls.find((c: any) => c.id === call.id);
          Object.assign(
            entry,
            d?.approve
              ? { status: "completed", approval: "approved" }
              : { status: "denied", approval: "denied" },
          );
          run.record.approvals.push({
            tool_call_id: call.id,
            decision: d?.approve ? "approved" : "denied",
            edited: false,
          });
          if (!(await execute(run, call, emit, !d?.approve))) return;
        }
        await loop(run, emit);
      });
    }
    const runGet = /^\/runs\/([^/]+)$/.exec(path);
    if (runGet && runs.has(runGet[1]!)) {
      const run = runs.get(runGet[1]!)!;
      return send(200, {
        ...result(run),
        spans: run.record.spans,
        approvals: run.record.approvals,
        duration_ms: run.record.duration_ms,
      });
    }
    send(404, { detail: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
