import type { EvalSpec } from "@armature/schema";
import type { CaseResult, RunOutcome, TrialResult } from "./run.ts";
import { bootstrapCi, mean, passAtK, passPowK, quantile } from "./stats.ts";

/**
 * Scores and gates. Task success counts VERIFIED cases only; when there are none the numbers
 * are computed over drafts and labelled DRAFT, and drafts never fail a gate (smoke and
 * contract failures excepted: those are wiring, not quality).
 */

export const NOT_MEASURED = "NOT_MEASURED" as const;
export type Measured = number | typeof NOT_MEASURED;

export const DIMENSIONS = [
  "tool_correctness",
  "orchestration",
  "context_rag",
  "memory",
  "safety",
  "efficiency",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface Rate {
  cases: number;
  passed: number;
}

export interface Summary {
  basis: "VERIFIED" | "DRAFT" | "NONE";
  cases: number;
  verified: number;
  drafts: number;
  trials: number;
  /** Share of cases (in the basis) that passed under their pass policy. */
  task_success: Measured;
  task_success_ci: [number, number] | null;
  /** Share of trials that passed. */
  pass_at_1: Measured;
  k: number;
  pass_at_k: Measured;
  pass_pow_k: Measured;
  draft_task_success: Measured;
  by_category: Record<string, Rate>;
  by_severity: Record<string, Rate>;
  dimensions: Record<Dimension, Measured>;
  cost_per_task_usd: Measured;
  latency_p50_ms: Measured;
  latency_p95_ms: Measured;
  steps_per_task: Measured;
  tool_errors_per_task: Measured;
  tokens_per_task: Measured;
  critical_failures: string[];
  contract_failures: Array<{ case: string; trial: number; message: string }>;
  timeouts: number;
}

const rate = (xs: boolean[]): Measured => (xs.length ? xs.filter(Boolean).length / xs.length : NOT_MEASURED);

function checkShare(trials: TrialResult[], names: string[]): Measured {
  const checks = trials
    .flatMap((t) => t.grade.checks)
    .filter((c) => names.includes(c.name) && c.status !== "not_measured");
  return rate(checks.map((c) => c.status === "pass"));
}

function bump(map: Record<string, Rate>, key: string, passed: boolean) {
  const r = map[key] ?? { cases: 0, passed: 0 };
  map[key] = r;
  r.cases++;
  if (passed) r.passed++;
}

export function summarize(outcome: RunOutcome, opts: { seed?: number } = {}): Summary {
  const all = outcome.cases;
  const verified = all.filter((c) => c.trust === "VERIFIED");
  const basisCases = verified.length ? verified : all;
  const basis: Summary["basis"] = all.length === 0 ? "NONE" : verified.length ? "VERIFIED" : "DRAFT";
  const trials = basisCases.flatMap((c) => c.trials);
  const ran = basisCases.filter((c) => c.trials.length > 0);

  const success = ran.map((c) => (c.passed ? 1 : 0));
  const k = ran.length ? Math.min(...ran.map((c) => c.trials.length)) : 0;
  const atK =
    k > 0
      ? mean(ran.map((c) => passAtK(c.trials.length, c.trials.filter((t) => t.grade.passed).length, k)))
      : null;
  const powK =
    k > 0
      ? mean(ran.map((c) => passPowK(c.trials.length, c.trials.filter((t) => t.grade.passed).length, k)))
      : null;

  const by_category: Record<string, Rate> = {};
  const by_severity: Record<string, Rate> = {};
  for (const c of ran) {
    bump(by_category, c.category, c.passed);
    bump(by_severity, c.severity, c.passed);
  }

  const costs = trials.map((t) => t.cost_usd);
  const knownCost = trials.length > 0 && costs.every((x) => x !== null);
  const latencies = trials
    .map((t) => t.latency_ms)
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const withRecord = trials.filter((t) => t.record !== null);
  const safetyTrials = basisCases
    .filter(
      (c) =>
        c.severity === "critical" ||
        c.trials.some((t) => t.grade.checks.some((x) => x.name === "approval_before")),
    )
    .flatMap((c) => c.trials);

  const dimensions: Record<Dimension, Measured> = {
    tool_correctness: checkShare(trials, ["must_call_any", "never_call"]),
    orchestration: checkShare(trials, ["max_steps", "max_tool_calls", "no_run_error"]),
    context_rag: NOT_MEASURED,
    memory: NOT_MEASURED,
    safety: rate(safetyTrials.map((t) => t.grade.passed)),
    efficiency: checkShare(trials, ["max_cost_usd", "max_latency_ms"]),
  };

  return {
    basis,
    cases: all.length,
    verified: verified.length,
    drafts: all.length - verified.length,
    trials: trials.length,
    task_success: success.length ? mean(success) : NOT_MEASURED,
    task_success_ci: bootstrapCi(success, opts.seed ?? 1),
    pass_at_1: rate(trials.map((t) => t.grade.passed)),
    k,
    pass_at_k: atK ?? NOT_MEASURED,
    pass_pow_k: powK ?? NOT_MEASURED,
    draft_task_success: rate(
      all.filter((c) => c.trust !== "VERIFIED" && c.trials.length).map((c) => c.passed),
    ),
    by_category,
    by_severity,
    dimensions,
    cost_per_task_usd:
      knownCost && ran.length ? (costs as number[]).reduce((a, b) => a + b, 0) / ran.length : NOT_MEASURED,
    latency_p50_ms: latencies.length >= 5 ? quantile(latencies, 0.5) : NOT_MEASURED,
    latency_p95_ms: latencies.length >= 20 ? quantile(latencies, 0.95) : NOT_MEASURED,
    steps_per_task: withRecord.length ? mean(withRecord.map((t) => t.steps ?? 0)) : NOT_MEASURED,
    tool_errors_per_task: withRecord.length ? mean(withRecord.map((t) => t.tool_errors)) : NOT_MEASURED,
    tokens_per_task: withRecord.length ? mean(withRecord.map((t) => t.tokens)) : NOT_MEASURED,
    critical_failures: verified.filter((c) => c.severity === "critical" && !c.passed).map((c) => c.id),
    contract_failures: all.flatMap((c) =>
      c.trials
        .filter((t) => t.failure?.kind === "contract")
        .map((t) => ({ case: c.id, trial: t.trial, message: t.failure!.message })),
    ),
    timeouts: all.reduce((n, c) => n + c.trials.filter((t) => t.failure?.kind === "timeout").length, 0),
  };
}

export interface Gate {
  name: string;
  passed: boolean;
  detail: string;
}

export function evaluateGates(opts: {
  suite: string;
  spec: EvalSpec;
  outcome: RunOutcome;
  summary: Summary;
  /** Null when the benchmark has never been frozen. */
  benchmarkChanged: boolean | null;
}): Gate[] {
  const { spec, summary, outcome } = opts;
  const gates: Gate[] = [];
  const allowed = spec.gates.critical_failures_allowed;
  gates.push({
    name: "critical_failures",
    passed: summary.critical_failures.length <= allowed,
    detail: summary.critical_failures.length
      ? `${summary.critical_failures.length} verified critical case(s) failed: ${summary.critical_failures.join(", ")}`
      : summary.verified
        ? "no verified critical case failed"
        : "no verified cases; drafts do not gate",
  });
  gates.push({
    name: "contract",
    passed: summary.contract_failures.length === 0,
    detail: summary.contract_failures.length
      ? summary.contract_failures
          .slice(0, 3)
          .map((f) => `${f.case}#${f.trial}: ${f.message}`)
          .join("; ")
      : "every request met the ARC contract",
  });
  if (opts.suite === "smoke") {
    const failed = outcome.cases.filter((c) => !c.passed).map((c) => c.id);
    gates.push({
      name: "smoke",
      passed: failed.length === 0,
      detail: failed.length ? `failed: ${failed.join(", ")}` : "every smoke case passed",
    });
  }
  if (spec.gates.fail_on_missing_required_measurements) {
    const missing = outcome.cases
      .filter((c) => c.trust === "VERIFIED")
      .flatMap((c) =>
        c.trials.flatMap((t) =>
          t.grade.checks.filter((x) => x.status === "not_measured").map((x) => `${c.id}: ${x.name}`),
        ),
      );
    const unique = [...new Set(missing)];
    gates.push({
      name: "required_measurements",
      passed: unique.length === 0,
      detail: unique.length
        ? `NOT_MEASURED: ${unique.slice(0, 5).join("; ")}`
        : "every grader on verified cases measured",
    });
  }
  if (opts.benchmarkChanged !== null)
    gates.push({
      name: "benchmark_frozen",
      passed: !opts.benchmarkChanged,
      detail: opts.benchmarkChanged
        ? "the benchmark changed since `armature eval freeze`"
        : "matches benchmark.lock",
    });
  gates.push({
    name: "budget",
    passed: !outcome.budget_exhausted,
    detail: outcome.budget_exhausted
      ? `stopped at $${outcome.spent_usd.toFixed(2)}; some trials did not run`
      : `$${outcome.spent_usd.toFixed(4)}${outcome.cost_incomplete ? " (lower bound: some costs unknown)" : ""}`,
  });
  if (opts.suite === "dev" && spec.targets.dev_pass_k !== undefined && summary.basis === "VERIFIED") {
    const v = summary.pass_pow_k;
    gates.push({
      name: "target_dev_pass_k",
      passed: typeof v === "number" && v >= spec.targets.dev_pass_k,
      detail: `pass^${summary.k} ${typeof v === "number" ? v.toFixed(2) : v} (target ${spec.targets.dev_pass_k})`,
    });
  }
  if (spec.targets.max_cost_per_task_usd !== undefined && summary.basis === "VERIFIED") {
    const v = summary.cost_per_task_usd;
    gates.push({
      name: "target_cost_per_task",
      passed: typeof v === "number" && v <= spec.targets.max_cost_per_task_usd,
      detail: `${typeof v === "number" ? `$${v.toFixed(4)}` : v} per task (target $${spec.targets.max_cost_per_task_usd})`,
    });
  }
  return gates;
}

export const gatesPassed = (gates: Gate[]) => gates.every((g) => g.passed);

export function failedTrials(c: CaseResult): TrialResult[] {
  return c.trials.filter((t) => !t.grade.passed);
}
