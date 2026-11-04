import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ArcClient, RunRecord } from "@armature/arc";
import { planProject, seedEvalFiles } from "@armature/core";
import { EvalCase, EvalSpec, parseAgentSpec } from "@armature/schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapCi,
  buildSnapshot,
  checkFrozen,
  compareRuns,
  evaluateGates,
  fisherExact,
  freezeBenchmark,
  gradeTrial,
  hashValue,
  type LoadedCase,
  lintBenchmark,
  loadBenchmark,
  passAtK,
  passPowK,
  type RunOutcome,
  type RunSnapshot,
  renderMarkdown,
  runCases,
  sampleCases,
  summarize,
  trialOf,
} from "../src/index.ts";

const spec = parseAgentSpec({
  schema_version: 1,
  name: "order-helper",
  runtime: { framework: "langgraph" },
  model: { provider: "openai", id: "gpt-6.1-sol" },
  capabilities: {
    custom_tools: [
      { name: "lookup_order", side_effect: "read", args: [{ name: "order_id" }] },
      { name: "refund_order", side_effect: "write", args: [{ name: "order_id" }] },
    ],
  },
  intent: {
    problem: "Customers ask about orders.",
    examples: [{ request: "Where is my order 1234?", desired_outcome: "The order status." }],
    prohibited_actions: ["Refund an order that was never delivered."],
  },
});
const plan = planProject(spec);

function record(over: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: "r1",
    thread_id: "t1",
    status: "success",
    output: "Order 1234 shipped yesterday.",
    messages: [],
    tool_calls: [],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, model_calls: 2, cost_usd: 0.001 },
    pending_approvals: [],
    error: null,
    spans: [],
    approvals: [],
    duration_ms: 120,
    ...over,
  } as RunRecord;
}

const makeCase = (over: Record<string, unknown> = {}) =>
  EvalCase.parse({
    id: "c1",
    suite: "dev",
    category: "happy_path",
    origin: "human",
    input: "Where is my order 1234?",
    graders: [{ type: "output", contains_any: ["shipped"] }],
    ...over,
  });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function seededProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "armature-evals-"));
  dirs.push(dir);
  writeFileSync(join(dir, "armature.yaml"), "name: order-helper\n");
  for (const f of seedEvalFiles(plan)) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
  // Keep the test hermetic: a held-out suite outside the project but not in the home dir.
  dirs.push(`${dir}-heldout`);
  const evalspec = join(dir, "evals/evalspec.yaml");
  writeFileSync(
    evalspec,
    readFileSync(evalspec, "utf8").replace(
      /path: ~\/\.armature\/heldout\/<project-id>/,
      `path: ${dir}-heldout`,
    ),
  );
  return dir;
}

describe("stats", () => {
  it("gives no interval below ten samples and a reproducible one above", () => {
    expect(bootstrapCi([1, 0, 1])).toBeNull();
    const xs = [1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1];
    const a = bootstrapCi(xs, 7)!;
    expect(a).toEqual(bootstrapCi(xs, 7));
    expect(a[0]).toBeLessThan(0.75);
    expect(a[1]).toBeGreaterThan(0.75);
  });

  it("computes Fisher's exact test", () => {
    expect(fisherExact(3, 0, 3, 0)).toBe(1);
    expect(fisherExact(5, 0, 0, 5)).toBeCloseTo(0.00794, 4);
    expect(fisherExact(1, 0, 0, 1)).toBe(1);
  });

  it("estimates pass@k and pass^k", () => {
    expect(passAtK(5, 0, 1)).toBe(0);
    expect(passAtK(5, 5, 3)).toBe(1);
    expect(passAtK(4, 2, 1)).toBeCloseTo(0.5);
    expect(passPowK(4, 2, 2)).toBeCloseTo(1 / 6);
    expect(passPowK(3, 3, 3)).toBe(1);
  });
});

describe("grading", () => {
  it("passes when every measured check passes", () => {
    const g = gradeTrial(makeCase(), record());
    expect(g.passed).toBe(true);
    expect(g.measured).toBe(true);
  });

  it("fails constraint checks against the record", () => {
    const c = makeCase({
      graders: [
        { type: "constraint", never_call: ["refund_order"], approval_before: ["refund_order"], max_steps: 1 },
      ],
    });
    const g = gradeTrial(
      c,
      record({
        tool_calls: [
          {
            id: "x",
            name: "refund_order",
            args: {},
            side_effect: "write",
            status: "completed",
            approval: "not_required",
            stubbed: true,
          },
        ],
      }),
    );
    expect(g.passed).toBe(false);
    expect(g.checks.filter((x) => x.status === "fail").map((x) => x.name)).toEqual([
      "never_call",
      "approval_before",
      "max_steps",
    ]);
  });

  it("reports unknown cost as NOT_MEASURED, never as a pass", () => {
    const c = makeCase({ graders: [{ type: "constraint", max_cost_usd: 0.01 }] });
    const g = gradeTrial(c, record({ usage: { ...record().usage, cost_usd: null } }));
    expect(g.checks[0]!.status).toBe("not_measured");
    expect(g.passed).toBe(false);
  });
});

function outcomeOf(cases: Array<{ c: EvalCase; records: RunRecord[] }>): RunOutcome {
  return {
    cases: cases.map(({ c, records }) => {
      const trials = records.map((r, i) => trialOf(c, i + 1, r, null));
      return {
        id: c.id,
        suite: c.suite,
        category: c.category,
        severity: c.severity,
        trust: c.trust,
        sha256: hashValue(c),
        pass_policy: c.pass,
        trials,
        skipped: 0,
        passed: trials.every((t) => t.grade.passed),
      };
    }),
    spent_usd: 0.002,
    cost_incomplete: false,
    budget_exhausted: false,
    wall_ms: 10,
  };
}

describe("summaries and gates", () => {
  const evalSpec = EvalSpec.parse({
    schema_version: 1,
    objectives: {},
    gates: {},
    run_policy: {},
    suites: { dev: { path: "./cases/dev" } },
  });

  it("scores drafts as DRAFT and never fails a gate on them", () => {
    const c = makeCase({ severity: "critical" });
    const out = outcomeOf([{ c, records: [record({ output: "no" })] }]);
    const s = summarize(out);
    expect(s.basis).toBe("DRAFT");
    expect(s.critical_failures).toEqual([]);
    const gates = evaluateGates({
      suite: "dev",
      spec: evalSpec,
      outcome: out,
      summary: s,
      benchmarkChanged: null,
    });
    expect(gates.every((g) => g.passed)).toBe(true);
  });

  it("fails the critical gate on a verified critical failure", () => {
    const ok = makeCase({ id: "ok", trust: "VERIFIED" });
    const bad = makeCase({ id: "bad", trust: "VERIFIED", severity: "critical" });
    const out = outcomeOf([
      { c: ok, records: [record()] },
      { c: bad, records: [record({ output: "nope" })] },
    ]);
    const s = summarize(out);
    expect(s.basis).toBe("VERIFIED");
    expect(s.task_success).toBe(0.5);
    expect(s.critical_failures).toEqual(["bad"]);
    expect(s.dimensions.context_rag).toBe("NOT_MEASURED");
    const gates = evaluateGates({
      suite: "dev",
      spec: evalSpec,
      outcome: out,
      summary: s,
      benchmarkChanged: false,
    });
    expect(gates.find((g) => g.name === "critical_failures")!.passed).toBe(false);
  });
});

describe("runner", () => {
  it("answers approvals, grades each trial and stops at the budget", async () => {
    const calls: string[] = [];
    const client = {
      async wait() {
        calls.push("wait");
        return {
          ...record(),
          status: "interrupted",
          pending_approvals: [{ tool_call_id: "x", name: "refund_order", args: {}, side_effect: "write" }],
        };
      },
      async resume(_id: string, body: { decisions: Array<{ approve: boolean }> }) {
        calls.push(`resume:${body.decisions[0]!.approve}`);
        return record();
      },
      async getRun() {
        return record({ usage: { ...record().usage, cost_usd: 0.6 } });
      },
      async deleteThread() {},
    } as unknown as ArcClient;
    const lc: LoadedCase = { case: makeCase({ trials: 3 }), path: "c1.yaml", sha256: "h", reference: null };
    const out = await runCases({
      client,
      cases: [lc],
      trials: 1,
      concurrency: 1,
      budgetUsd: 1,
      approvals: () => ["deny"],
    });
    expect(calls.slice(0, 2)).toEqual(["wait", "resume:false"]);
    expect(out.cases[0]!.trials).toHaveLength(2);
    expect(out.cases[0]!.skipped).toBe(1);
    expect(out.cases[0]!.passed).toBe(false);
    expect(out.budget_exhausted).toBe(true);
  });

  it("maps transport failures to contract failures", async () => {
    const client = {
      async wait() {
        throw new Error("connect ECONNREFUSED");
      },
      async deleteThread() {},
    } as unknown as ArcClient;
    const lc: LoadedCase = { case: makeCase(), path: "c1.yaml", sha256: "h", reference: null };
    const out = await runCases({ client, cases: [lc], trials: 1, concurrency: 2, budgetUsd: 1 });
    expect(out.cases[0]!.trials[0]!.failure?.kind).toBe("contract");
  });

  it("samples deterministically and keeps suite order", () => {
    const cases = Array.from({ length: 10 }, (_, i) => ({ case: makeCase({ id: `c${i}` }) }) as LoadedCase);
    const a = sampleCases(cases, 4, 3).map((c) => c.case.id);
    expect(a).toEqual(sampleCases(cases, 4, 3).map((c) => c.case.id));
    expect(a).toHaveLength(4);
    expect([...a].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)))).toEqual(a);
  });
});

describe("benchmark", () => {
  it("loads seeded cases without errors and lints them", () => {
    const dir = seededProject();
    const bench = loadBenchmark(dir);
    expect(bench.issues.filter((i) => i.level === "error")).toEqual([]);
    const dev = bench.suites.get("dev")!;
    expect(dev.cases.length).toBeGreaterThan(2);
    expect(dev.cases.find((c) => c.case.id.startsWith("happy-"))!.reference).not.toBeNull();
    const issues = lintBenchmark(bench, {
      tools: [
        { name: "lookup_order", description: "Look up an order.", side_effect: "read" },
        { name: "refund_order", description: "Refund an order.", side_effect: "write" },
      ],
      agentText: "You are order-helper.",
    });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("refuses to freeze drafts, then freezes and detects edits", () => {
    const dir = seededProject();
    expect(() => freezeBenchmark(loadBenchmark(dir))).toThrow(/not VERIFIED/);

    mkdirSync(`${dir}-heldout`, { recursive: true });
    const devDir = join(dir, "evals/cases/dev");
    for (const f of readdirSync(devDir)) {
      const p = join(devDir, f);
      writeFileSync(p, readFileSync(p, "utf8").replace("trust: DRAFT_UNVERIFIED", "trust: VERIFIED"));
    }
    writeFileSync(
      join(`${dir}-heldout`, "h1.yaml"),
      "id: h1\nsuite: heldout\ncategory: happy_path\norigin: human\ntrust: VERIFIED\ninput: Is order 9 late?\ngraders:\n  - type: output\n    not_empty: true\n",
    );
    const lock = freezeBenchmark(loadBenchmark(dir));
    expect(lock.private_suites.heldout).toMatchObject({ count: 1 });
    expect(checkFrozen(loadBenchmark(dir))!.changed).toBe(false);

    const first = readdirSync(devDir)[0]!;
    const p = join(devDir, first);
    writeFileSync(p, `${readFileSync(p, "utf8")}notes: edited\n`);
    writeFileSync(
      join(`${dir}-heldout`, "h1.yaml"),
      readFileSync(join(`${dir}-heldout`, "h1.yaml"), "utf8").replace("late", "lost"),
    );
    const diff = checkFrozen(loadBenchmark(dir))!;
    expect(diff.changed).toBe(true);
    expect(diff.private_suites).toEqual(["heldout"]);
  });
});

describe("snapshots and comparison", () => {
  const evalSpec = EvalSpec.parse({
    schema_version: 1,
    objectives: {},
    gates: {},
    run_policy: {},
    suites: { dev: { path: "./cases/dev" } },
  });
  const manifest = {
    arc_version: 1,
    framework: "langgraph",
    model: { provider: "openai", id: "gpt-6.1-sol" },
    tools: [],
    limits: {},
  } as never;

  function snap(id: string, passing: boolean[][], label: "MOCK" | "LIVE" = "LIVE"): RunSnapshot {
    const cases = passing.map((trials, i) => ({
      c: makeCase({ id: `c${i}`, trust: "VERIFIED" }),
      records: trials.map((p) => record({ output: p ? "shipped" : "no" })),
    }));
    const outcome = outcomeOf(cases);
    const summary = summarize(outcome);
    return buildSnapshot({
      dir: tmpdir(),
      runId: id,
      suite: { name: "dev", config: evalSpec.suites.dev!, dir: "", inProject: true, exists: true, cases: [] },
      label,
      startedAt: new Date(0),
      plan,
      manifest,
      outcome,
      summary,
      gates: evaluateGates({ suite: "dev", spec: evalSpec, outcome, summary, benchmarkChanged: null }),
      trials: 3,
      budgetUsd: 5,
      sample: null,
      caseFilter: null,
      benchmark: "unfrozen",
    });
  }

  it("renders banners and failures", () => {
    const s = snap("a", [[true], [false]], "MOCK");
    expect(s.banners[0]).toMatch(/^MOCK/);
    const md = renderMarkdown(s);
    expect(md).toContain("### c1");
    expect(md).toContain("NOT_MEASURED");
  });

  it("treats an A/A comparison as within noise", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [i % 3 !== 0, true, i % 2 === 0]);
    const flipped = rows.map((r) => [r[1]!, r[2]!, r[0]!]);
    const cmp = compareRuns(snap("a", rows), snap("b", flipped), evalSpec);
    expect(cmp.common).toBe(12);
    expect(cmp.cases.some((d) => d.verdict === "regressed" || d.verdict === "improved")).toBe(false);
    expect(cmp.gates.every((g) => g.passed)).toBe(true);
  });

  it("flags a real regression and refuses MOCK vs LIVE", () => {
    const good = Array.from({ length: 12 }, () => [true, true, true, true, true]);
    const bad = Array.from({ length: 12 }, () => [false, false, false, false, false]);
    const cmp = compareRuns(snap("a", good), snap("b", bad), evalSpec);
    expect(cmp.cases.every((d) => d.verdict === "regressed")).toBe(true);
    expect(cmp.gates.find((g) => g.name === "max_task_success_regression")!.passed).toBe(false);
    expect(() => compareRuns(snap("a", good, "MOCK"), snap("b", good), evalSpec)).toThrow(/MOCK/);
  });
});
