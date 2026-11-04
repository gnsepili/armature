import type { ProjectPlan } from "@armature/core";
import type { Script } from "@armature/mock-llm";
import { REFUSAL_CATEGORIES } from "@armature/schema";
import { firstUserText, type Issue, type LoadedCase } from "./load.ts";
import { type RunOutcome, runCases, type TrialResult } from "./run.ts";
import type { EvalSession } from "./session.ts";
import { rng } from "./stats.ts";

/**
 * Suite-level orchestration on top of `runCases`: offline scripting from reference
 * trajectories, deterministic sampling, cost estimates and the dynamic benchmark checks.
 */

/** Deterministic sample of n cases (Fisher-Yates on a seeded RNG), returned in suite order. */
export function sampleCases(cases: LoadedCase[], n: number, seed: number): LoadedCase[] {
  if (n >= cases.length) return cases;
  const idx = cases.map((_, i) => i);
  const rand = rng(seed);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  const keep = new Set(idx.slice(0, n));
  return cases.filter((_, i) => keep.has(i));
}

/**
 * A rough upper estimate of a live run's cost: model calls per trial from max_steps
 * (default 4), with 3,000 input and 400 output tokens per call. Null when prices are unknown.
 */
export function estimateCost(plan: ProjectPlan, cases: LoadedCase[], trials: number): number | null {
  const { price_input, price_output } = plan.model;
  if (price_input === null || price_output === null) return null;
  let calls = 0;
  for (const lc of cases) {
    const maxSteps = lc.case.graders.flatMap((g) =>
      g.type === "constraint" && g.max_steps ? [g.max_steps] : [],
    )[0];
    calls += (lc.case.trials ?? trials) * Math.min(maxSteps ?? 4, 8);
  }
  return (calls * (3000 * price_input + 400 * price_output)) / 1_000_000;
}

const scriptOf = (lc: LoadedCase): Script | null =>
  lc.reference ? { match: firstUserText(lc.case), steps: lc.reference.steps as Script["steps"] } : null;

export interface SuiteRunOptions {
  session: EvalSession;
  cases: LoadedCase[];
  trials: number;
  concurrency: number;
  budgetUsd: number;
  onTrial?: (c: LoadedCase, t: TrialResult) => void;
}

/**
 * Runs cases in the session. Offline, a case with a reference trajectory is answered by that
 * script and the rest by the mock's smoke mode; trials then run one at a time.
 */
export function runSuite(opts: SuiteRunOptions): Promise<RunOutcome> {
  const { session } = opts;
  const mock = session.mock;
  return runCases({
    client: session.client,
    cases: opts.cases,
    trials: opts.trials,
    concurrency: opts.concurrency,
    budgetUsd: opts.budgetUsd,
    approvals: (lc) => lc.reference?.approvals ?? [],
    ...(mock
      ? {
          beforeTrial: (lc: LoadedCase) => {
            mock.clearScripts();
            mock.setMode("smoke");
            const s = scriptOf(lc);
            if (s) mock.addScripts([s]);
          },
        }
      : {}),
    ...(opts.onTrial ? { onTrial: opts.onTrial } : {}),
  });
}

export interface DynamicResult {
  null_agent: { checked: number; passing: string[] };
  references: { checked: number; failing: Array<{ case: string; reason: string }> };
  issues: Issue[];
}

const reasonOf = (t: TrialResult | undefined): string => {
  if (!t) return "did not run";
  if (t.failure) return `${t.failure.kind}: ${t.failure.message}`;
  const failed = t.grade.checks.filter((c) => c.status === "fail");
  if (failed.length) return failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join("; ");
  return "no grader measured anything";
};

/**
 * Dynamic checks against the mock model (no credentials, no cost):
 * - null agent: a model that only says "I can't help with that." must fail every case that
 *   is not smoke and not a refusal case; one that passes has graders too weak to mean anything;
 * - reference: replaying a case's reference trajectory must pass its own graders.
 */
export async function validateDynamic(session: EvalSession, cases: LoadedCase[]): Promise<DynamicResult> {
  const mock = session.mock;
  if (!mock) throw new Error("dynamic validation needs an offline session");
  const issues: Issue[] = [];

  const nullTargets = cases.filter(
    (lc) => lc.case.suite !== "smoke" && !REFUSAL_CATEGORIES.has(lc.case.category),
  );
  mock.clearScripts();
  mock.setMode("null");
  const nullRun = await runCases({
    client: session.client,
    cases: nullTargets,
    trials: 1,
    concurrency: 4,
    budgetUsd: Infinity,
  });
  const passing = nullRun.cases.filter((c) => c.trials.some((t) => t.grade.passed)).map((c) => c.id);
  for (const id of passing) {
    const lc = nullTargets.find((x) => x.case.id === id)!;
    issues.push({
      level: "error",
      case: id,
      path: lc.path,
      message:
        "passes against a null agent that refuses everything; add a grader that a real answer must meet",
    });
  }

  const refTargets = cases.filter((lc) => lc.reference);
  const refRun = await runCases({
    client: session.client,
    cases: refTargets,
    trials: 1,
    concurrency: 1,
    budgetUsd: Infinity,
    approvals: (lc) => lc.reference?.approvals ?? [],
    beforeTrial: (lc) => {
      mock.clearScripts();
      mock.setMode("smoke");
      mock.addScripts([scriptOf(lc)!]);
    },
  });
  const failing = refRun.cases
    .filter((c) => !c.trials.every((t) => t.grade.passed))
    .map((c) => ({ case: c.id, reason: reasonOf(c.trials.find((t) => !t.grade.passed)) }));
  for (const f of failing) {
    const lc = refTargets.find((x) => x.case.id === f.case)!;
    issues.push({
      level: "error",
      case: f.case,
      path: lc.path,
      message: `its reference trajectory fails the case's own graders: ${f.reason}`,
    });
  }
  mock.clearScripts();
  mock.setMode("smoke");
  return {
    null_agent: { checked: nullTargets.length, passing },
    references: { checked: refTargets.length, failing },
    issues,
  };
}
