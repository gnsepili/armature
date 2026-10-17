import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { synthesize } from "@armature/mock-llm";
import { ArcClient, type ArcEvent, ArcHttpError } from "./client.ts";
import { streamedText, validateEventStream } from "./events.ts";
import {
  CUSTOM_EVENTS,
  Health,
  Manifest,
  type ManifestTool,
  RunRecord,
  RunResult,
  type RunResult as RunResultT,
} from "./types.ts";

export type CheckStatus = "PASS" | "FAIL" | "NOT_APPLICABLE";
export interface CheckResult {
  id: number;
  key: string;
  title: string;
  status: CheckStatus;
  details: string[];
  duration_ms: number;
}
export interface ConformanceReport {
  arc_version: 1;
  passed: boolean;
  checks: CheckResult[];
}

export interface ConformanceOptions {
  /** ARC app running with ARMATURE_EVAL_MODE=1 against the mock LLM. */
  app: string;
  /** The same app outside eval mode; needed for check 7. */
  normalApp?: string;
  /** Mock LLM root URL (control API lives at /__mock). */
  mockUrl: string;
  timeoutMs?: number;
  onCheck?: (result: CheckResult) => void;
}

export const CHECKS = [
  { key: "health_manifest", title: "/health and /manifest validate against schema" },
  { key: "tool_run", title: "one scripted tool call streams the expected events and matches /runs/wait" },
  {
    key: "approval",
    title: "write tools pause for approval; approve completes, deny continues without the call",
  },
  { key: "limits", title: "a limit breach yields RUN_ERROR with partial output and no hang" },
  { key: "spans", title: "run record has an invoke_agent root with chat and execute_tool children" },
  { key: "isolation", title: "two eval trials of one case share no thread or memory" },
  { key: "eval_gate", title: "eval-mode metadata is rejected outside eval mode" },
] as const;

class Fail extends Error {}
class NotApplicable extends Error {}
const must = (cond: unknown, message: string): void => {
  if (!cond) throw new Fail(message);
};

interface MockScriptStep {
  text?: string;
  tool_calls?: Array<{ name: string; args?: Record<string, unknown> }>;
}

class MockControl {
  constructor(private readonly url: string) {}
  async script(match: string, steps: MockScriptStep[]) {
    const res = await fetch(`${this.url}/__mock/scripts`, {
      method: "POST",
      body: JSON.stringify({ match, steps }),
    });
    if (!res.ok) throw new Error(`mock LLM rejected script: HTTP ${res.status}`);
  }
  async requestsFor(match: string) {
    const res = await fetch(`${this.url}/__mock/log`);
    const { requests } = (await res.json()) as {
      requests: Array<{ messages: Array<{ role: string; content?: unknown; tool_call_id?: string }> }>;
    };
    return requests.filter((r) => {
      const first = r.messages.find((m) => m.role === "user");
      return typeof first?.content === "string" && first.content.trim() === match;
    });
  }
}

/** Runs the ARC v1 conformance suite. Each check is independent; failures never stop the suite. */
export async function runConformance(options: ConformanceOptions): Promise<ConformanceReport> {
  const app = new ArcClient(options.app, options.timeoutMs ?? 60_000);
  const mock = new MockControl(options.mockUrl.replace(/\/+$/, "").replace(/\/v1$/, ""));
  const nonce = randomUUID().slice(0, 8);
  let manifest: Manifest | undefined;
  let toolRunId: string | undefined;

  const stubs = () =>
    Object.fromEntries(
      (manifest?.tools ?? []).map((t) => [t.name, { result: { ok: true, stub: "arc-conformance" } }]),
    );
  const evalMeta = (caseId: string, trial = 1) => ({ eval: { case_id: caseId, trial, stubs: stubs() } });
  const finalStep = (): { text: string; expected: unknown } => {
    const so = manifest?.capabilities.structured_output;
    if (so?.enabled && so.schema) {
      const value = synthesize(so.schema);
      return { text: JSON.stringify(value), expected: value };
    }
    return { text: "arc-conformance-ok", expected: "arc-conformance-ok" };
  };
  const argsFor = (tool: ManifestTool) => synthesize(tool.input_schema) as Record<string, unknown>;
  const collect = async (gen: AsyncGenerator<ArcEvent>) => {
    const events: ArcEvent[] = [];
    for await (const e of gen) events.push(e);
    return events;
  };
  const parse = <T>(
    schema: {
      safeParse(v: unknown): {
        success: boolean;
        error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
        data?: T;
      };
    },
    value: unknown,
    what: string,
  ): T => {
    const r = schema.safeParse(value);
    if (!r.success) {
      const issue = r.error!.issues[0]!;
      throw new Fail(
        `${what} does not match the ARC schema at ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      );
    }
    return r.data as T;
  };

  const bodies: Array<() => Promise<string[] | undefined>> = [
    // 1
    async () => {
      const health = parse<Health>(Health, await app.health(), "/health");
      must(health.eval_mode, "conformance needs the app running with ARMATURE_EVAL_MODE=1");
      manifest = parse<Manifest>(Manifest, await app.manifest(), "/manifest");
      return [`${manifest.framework} · ${manifest.tools.length} tool(s)`];
    },
    // 2
    async () => {
      if (!manifest) throw new Fail("manifest unavailable");
      const input = `arc tool run ${nonce}`;
      const tool = manifest.tools.find((t) => !t.requires_approval) ?? manifest.tools[0];
      const final = finalStep();
      const steps: MockScriptStep[] = tool
        ? [{ tool_calls: [{ name: tool.name, args: argsFor(tool) }] }]
        : [];
      steps.push({ text: final.text });
      await mock.script(input, steps);

      const events = await collect(app.stream({ input, metadata: evalMeta("arc-tool-run") }));
      const problems = validateEventStream(events);
      must(problems.length === 0, problems.slice(0, 5).join("; "));
      const finished = events.at(-1)!;
      must(
        finished.type === "RUN_FINISHED",
        `stream ended with ${finished.type}: ${String(finished.message ?? "")}`,
      );
      const outcome = finished.outcome as { type?: string } | undefined;
      must(
        !outcome || outcome.type === "success",
        `RUN_FINISHED outcome is ${outcome?.type}, expected success`,
      );
      if (tool) {
        const ids = events
          .filter((e) => e.type === "TOOL_CALL_START" && e.toolCallName === tool.name)
          .map((e) => e.toolCallId);
        must(ids.length === 1, `expected one TOOL_CALL_START for ${tool.name}, got ${ids.length}`);
        const args = events
          .filter((e) => e.type === "TOOL_CALL_ARGS" && e.toolCallId === ids[0])
          .map((e) => e.delta)
          .join("");
        must(
          isDeepStrictEqual(JSON.parse(args || "{}"), argsFor(tool)),
          `streamed tool args ${args} differ from the scripted args`,
        );
        must(
          events.some((e) => e.type === "TOOL_CALL_RESULT" && e.toolCallId === ids[0]),
          "no TOOL_CALL_RESULT for the tool call",
        );
      }
      must(
        streamedText(events).includes(final.text),
        `streamed text does not contain the scripted reply ${final.text}`,
      );
      must(
        events.some((e) => e.type === "CUSTOM" && e.name === CUSTOM_EVENTS.usage),
        `no CUSTOM ${CUSTOM_EVENTS.usage} event`,
      );

      const result = parse<RunResultT>(
        RunResult,
        await app.wait({ input, metadata: evalMeta("arc-tool-run") }),
        "/runs/wait",
      );
      must(result.status === "success", `/runs/wait status ${result.status}: ${result.error?.message ?? ""}`);
      must(
        isDeepStrictEqual(result.output, final.expected),
        `/runs/wait output ${JSON.stringify(result.output)} differs from ${JSON.stringify(final.expected)}`,
      );
      must(
        isDeepStrictEqual(
          result.tool_calls.map((c) => c.name),
          tool ? [tool.name] : [],
        ),
        `/runs/wait tool_calls ${result.tool_calls.map((c) => c.name).join(",")} differ from the stream`,
      );
      must(
        result.tool_calls.every((c) => c.status === "completed"),
        "tool call did not complete",
      );
      must(
        result.usage.model_calls === steps.length,
        `usage.model_calls is ${result.usage.model_calls}, expected ${steps.length}`,
      );
      must(result.usage.total_tokens > 0, "usage.total_tokens is 0");
      toolRunId = result.run_id;
      return [`${events.length} events; output matches /runs/wait`];
    },
    // 3
    async () => {
      if (!manifest) throw new Fail("manifest unavailable");
      const tool = manifest.tools.find((t) => t.requires_approval);
      if (!tool) throw new NotApplicable("no tool requires approval");
      const final = finalStep();
      const notes: string[] = [];

      const approveInput = `arc approve ${nonce}`;
      await mock.script(approveInput, [
        { tool_calls: [{ name: tool.name, args: argsFor(tool) }] },
        { text: final.text },
      ]);
      const events = await collect(app.stream({ input: approveInput, metadata: evalMeta("arc-approve") }));
      const problems = validateEventStream(events);
      must(problems.length === 0, problems.slice(0, 5).join("; "));
      const custom = events.find((e) => e.type === "CUSTOM" && e.name === CUSTOM_EVENTS.approvalRequired);
      must(custom, `no CUSTOM ${CUSTOM_EVENTS.approvalRequired} event before pausing`);
      const finished = events.at(-1)!;
      const outcome = finished.outcome as
        | { type?: string; interrupts?: Array<{ toolCallId?: string }> }
        | undefined;
      must(
        finished.type === "RUN_FINISHED" && outcome?.type === "interrupt",
        "paused run must end with RUN_FINISHED outcome interrupt",
      );
      const callId = outcome!.interrupts?.[0]?.toolCallId;
      must(callId, "interrupt has no toolCallId");
      must(!events.some((e) => e.type === "TOOL_CALL_RESULT"), "tool executed before approval");
      const runId = events[0]!.runId as string;
      const approved = parse<RunResultT>(
        RunResult,
        await app.resume(runId, { decisions: [{ tool_call_id: callId!, approve: true }] }),
        "resume result",
      );
      must(
        approved.status === "success",
        `approved run status ${approved.status}: ${approved.error?.message ?? ""}`,
      );
      const call = approved.tool_calls.find((c) => c.id === callId);
      must(
        call?.status === "completed" && call.approval === "approved",
        `approved call is ${call?.status}/${call?.approval}`,
      );
      must(
        isDeepStrictEqual(approved.output, final.expected),
        "approved run did not finish with the scripted reply",
      );
      notes.push("approve → completed");

      const denyInput = `arc deny ${nonce}`;
      await mock.script(denyInput, [
        { tool_calls: [{ name: tool.name, args: argsFor(tool) }] },
        { text: final.text },
      ]);
      const paused = parse<RunResultT>(
        RunResult,
        await app.wait({ input: denyInput, metadata: evalMeta("arc-deny") }),
        "/runs/wait",
      );
      must(paused.status === "interrupted", `write tool did not pause: status ${paused.status}`);
      must(
        paused.pending_approvals.length === 1 && paused.pending_approvals[0]!.name === tool.name,
        "pending_approvals does not list the write tool",
      );
      const denyId = paused.pending_approvals[0]!.tool_call_id;
      const denied = parse<RunResultT>(
        RunResult,
        await app.resume(paused.run_id, { decisions: [{ tool_call_id: denyId, approve: false }] }),
        "resume result",
      );
      must(denied.status === "success", `denied run status ${denied.status}: ${denied.error?.message ?? ""}`);
      const deniedCall = denied.tool_calls.find((c) => c.id === denyId);
      must(
        deniedCall?.status === "denied" && deniedCall.approval === "denied",
        `denied call is ${deniedCall?.status}/${deniedCall?.approval}`,
      );
      must(isDeepStrictEqual(denied.output, final.expected), "agent did not continue after the denial");
      const after = (await mock.requestsFor(denyInput)).at(-1);
      must(
        after?.messages.some((m) => m.role === "tool" && m.tool_call_id === denyId),
        "the model never saw a denial message for the call",
      );
      notes.push("deny → agent continued");
      return notes;
    },
    // 4
    async () => {
      if (!manifest) throw new Fail("manifest unavailable");
      const tool = manifest.tools.find((t) => !t.requires_approval);
      if (!tool) throw new NotApplicable("no tool runs without approval, so a step limit cannot be scripted");
      const n = Math.min(manifest.limits.max_steps, manifest.limits.max_tool_calls) + 1;
      if (n > 101) throw new NotApplicable(`limits (${n - 1}) are too high to breach in conformance`);
      const input = `arc limits ${nonce}`;
      await mock.script(
        input,
        Array.from({ length: n + 2 }, () => ({ tool_calls: [{ name: tool.name, args: argsFor(tool) }] })),
      );
      const started = Date.now();
      const result = parse<RunResultT>(
        RunResult,
        await app.wait({ input, metadata: evalMeta("arc-limits") }),
        "/runs/wait",
      );
      must(
        result.status === "error" && result.error?.code === "limit_exceeded",
        `expected error limit_exceeded, got ${result.status} ${result.error?.code ?? ""}`,
      );
      must(
        result.tool_calls.length > 0 && result.messages.length > 0,
        "limit breach returned no partial output",
      );
      const events = await collect(app.stream({ input, metadata: evalMeta("arc-limits") }));
      const problems = validateEventStream(events);
      must(problems.length === 0, problems.slice(0, 5).join("; "));
      const last = events.at(-1)!;
      must(
        last.type === "RUN_ERROR" && last.code === "limit_exceeded",
        `stream ended with ${last.type} ${String(last.code ?? "")}`,
      );
      return [`breached after ${result.tool_calls.length} tool calls in ${Date.now() - started} ms`];
    },
    // 5
    async () => {
      if (!manifest) throw new Fail("manifest unavailable");
      if (!toolRunId) {
        const input = `arc spans ${nonce}`;
        const tool = manifest.tools.find((t) => !t.requires_approval);
        await mock.script(input, [
          ...(tool ? [{ tool_calls: [{ name: tool.name, args: argsFor(tool) }] }] : []),
          { text: finalStep().text },
        ]);
        toolRunId = (await app.wait({ input, metadata: evalMeta("arc-spans") })).run_id;
      }
      const record = parse<RunRecord>(RunRecord, await app.getRun(toolRunId), `/runs/${toolRunId}`);
      const roots = record.spans.filter((s) => s.parent_id === null);
      must(
        roots.length === 1 && roots[0]!.operation === "invoke_agent",
        `expected one invoke_agent root span, got ${roots.map((r) => r.operation).join(",") || "none"}`,
      );
      const byId = new Map(record.spans.map((s) => [s.span_id, s]));
      for (const s of record.spans) {
        let cur = s;
        let hops = 0;
        while (cur.parent_id !== null && hops++ < 50) {
          const parent = byId.get(cur.parent_id);
          must(parent, `span ${s.name} has unknown parent ${cur.parent_id}`);
          cur = parent!;
        }
        must(cur === roots[0], `span ${s.name} is not under the invoke_agent root`);
      }
      must(
        record.spans.some((s) => s.operation === "chat"),
        "no chat span",
      );
      if (manifest.tools.length > 0)
        must(
          record.spans.some((s) => s.operation === "execute_tool"),
          "no execute_tool span",
        );
      return [`${record.spans.length} spans`];
    },
    // 6
    async () => {
      const input = `arc isolation ${nonce}`;
      await mock.script(input, [{ text: finalStep().text }]);
      const a = await app.wait({ input, metadata: evalMeta("arc-isolation", 1) });
      const b = await app.wait({ input, metadata: evalMeta("arc-isolation", 2) });
      must(a.status === "success" && b.status === "success", `trial status ${a.status}/${b.status}`);
      must(a.thread_id !== b.thread_id, `both trials ran on thread ${a.thread_id}`);
      const reqs = await mock.requestsFor(input);
      must(reqs.length === 2, `expected 2 model requests, saw ${reqs.length}`);
      const users = reqs[1]!.messages.filter((m) => m.role === "user").length;
      must(users === 1, `trial 2 sent ${users} user messages to the model; trial 1 leaked into it`);
      return ["distinct threads, no shared history"];
    },
    // 7
    async () => {
      if (!options.normalApp) throw new NotApplicable("no non-eval app URL given");
      const normal = new ArcClient(options.normalApp, options.timeoutMs ?? 60_000);
      const health = await normal.health();
      must(health.eval_mode === false, "the normal app reports eval_mode true");
      try {
        await normal.wait({
          input: `arc gate ${nonce}`,
          metadata: { eval: { case_id: "arc-gate", stubs: {} } },
        });
      } catch (err) {
        if (err instanceof ArcHttpError && err.status >= 400 && err.status < 500)
          return [`rejected with HTTP ${err.status}`];
        throw err;
      }
      throw new Fail("eval metadata was accepted outside eval mode");
    },
  ];

  const checks: CheckResult[] = [];
  for (const [i, body] of bodies.entries()) {
    const started = Date.now();
    const meta = CHECKS[i]!;
    let status: CheckStatus = "PASS";
    let details: string[] = [];
    try {
      details = (await body()) ?? [];
    } catch (err) {
      if (err instanceof NotApplicable) status = "NOT_APPLICABLE";
      else status = "FAIL";
      details = [err instanceof Error ? err.message : String(err)];
    }
    const result = {
      id: i + 1,
      key: meta.key,
      title: meta.title,
      status,
      details,
      duration_ms: Date.now() - started,
    };
    checks.push(result);
    options.onCheck?.(result);
  }
  return { arc_version: 1, passed: checks.every((c) => c.status !== "FAIL"), checks };
}
