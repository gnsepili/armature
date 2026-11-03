import { randomUUID } from "node:crypto";
import { type ArcClient, ArcHttpError, type RunRecord, type RunResult } from "@armature/arc";
import type { EvalCase } from "@armature/schema";
import { gradeTrial, type TrialGrade } from "./grade.ts";
import type { LoadedCase } from "./load.ts";

/** Runs cases through ARC: a fresh thread per trial, approvals answered, the record graded. */

export type FailureKind = "contract" | "timeout";

export interface TrialResult {
  trial: number;
  run_id: string | null;
  status: RunRecord["status"] | null;
  failure: { kind: FailureKind; message: string } | null;
  grade: TrialGrade;
  cost_usd: number | null;
  latency_ms: number | null;
  steps: number | null;
  tool_calls: number;
  tool_errors: number;
  tokens: number;
  /** Kept in memory for reports and debugging; snapshots store a trimmed copy. */
  record: RunRecord | null;
}

export interface CaseResult {
  id: string;
  suite: string;
  category: EvalCase["category"];
  severity: EvalCase["severity"];
  trust: EvalCase["trust"];
  sha256: string;
  pass_policy: EvalCase["pass"];
  trials: TrialResult[];
  /** Trials that did not run because the budget ran out. */
  skipped: number;
  passed: boolean;
}

export interface RunOptions {
  client: ArcClient;
  cases: LoadedCase[];
  /** Suite default; a case's own `trials` wins. */
  trials: number;
  concurrency: number;
  budgetUsd: number;
  /** Decisions for approvals, in order. Defaults to approving everything. */
  approvals?: (c: LoadedCase) => Array<"approve" | "deny">;
  /** Runs before each trial; when set, trials run one at a time (the mock model is shared). */
  beforeTrial?: (c: LoadedCase, trial: number) => Promise<void> | void;
  onTrial?: (c: LoadedCase, t: TrialResult) => void;
}

export interface RunOutcome {
  cases: CaseResult[];
  spent_usd: number;
  /** True when cost was unknown for at least one trial, so `spent_usd` is a lower bound. */
  cost_incomplete: boolean;
  budget_exhausted: boolean;
  wall_ms: number;
}

const MAX_RESUMES = 25;

async function execute(
  client: ArcClient,
  lc: LoadedCase,
  trial: number,
  decisions: Array<"approve" | "deny">,
): Promise<{ record: RunRecord | null; failure: TrialResult["failure"] }> {
  const c = lc.case;
  const threadId = randomUUID();
  const queue = [...decisions];
  try {
    let result: RunResult = await client.wait({
      thread_id: threadId,
      input: c.input,
      metadata: {
        eval: {
          case_id: c.id,
          trial,
          ...(c.fixtures ? { fixtures: c.fixtures } : {}),
          ...(c.stubs ? { stubs: c.stubs } : {}),
        },
      },
    });
    for (let i = 0; result.status === "interrupted" && result.pending_approvals.length; i++) {
      if (i >= MAX_RESUMES)
        return {
          record: null,
          failure: { kind: "contract", message: `still waiting for approval after ${MAX_RESUMES} resumes` },
        };
      result = await client.resume(result.run_id, {
        decisions: result.pending_approvals.map((p) => ({
          tool_call_id: p.tool_call_id,
          approve: (queue.length ? queue.shift() : "approve") === "approve",
        })),
      });
    }
    const record = await client.getRun(result.run_id);
    return { record, failure: null };
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError")
      return { record: null, failure: { kind: "timeout", message: "the request to the app timed out" } };
    if (err instanceof ArcHttpError)
      return { record: null, failure: { kind: "contract", message: err.message } };
    return { record: null, failure: { kind: "contract", message: `cannot reach the app: ${e.message}` } };
  } finally {
    client.deleteThread(threadId).catch(() => {});
  }
}

export function trialOf(
  c: EvalCase,
  trial: number,
  record: RunRecord | null,
  failure: TrialResult["failure"],
): TrialResult {
  return {
    trial,
    run_id: record?.run_id ?? null,
    status: record?.status ?? null,
    failure,
    grade: gradeTrial(c, record),
    cost_usd: record ? record.usage.cost_usd : null,
    latency_ms: record?.duration_ms ?? null,
    steps: record ? record.usage.model_calls : null,
    tool_calls: record?.tool_calls.length ?? 0,
    tool_errors: record?.tool_calls.filter((t) => t.status === "error").length ?? 0,
    tokens: record?.usage.total_tokens ?? 0,
    record,
  };
}

export function casePassed(policy: EvalCase["pass"], trials: TrialResult[]): boolean {
  if (trials.length === 0) return false;
  return policy === "any" ? trials.some((t) => t.grade.passed) : trials.every((t) => t.grade.passed);
}

export async function runCases(opts: RunOptions): Promise<RunOutcome> {
  const started = Date.now();
  const tasks: Array<{ lc: LoadedCase; trial: number }> = [];
  for (const lc of opts.cases) {
    const n = lc.case.trials ?? opts.trials;
    for (let t = 1; t <= n; t++) tasks.push({ lc, trial: t });
  }
  const results = new Map<string, TrialResult[]>(opts.cases.map((lc) => [lc.case.id, []]));
  const skipped = new Map<string, number>();
  let spent = 0;
  let incomplete = false;
  let exhausted = false;
  let next = 0;

  const worker = async () => {
    while (next < tasks.length) {
      const { lc, trial } = tasks[next++]!;
      if (spent >= opts.budgetUsd) {
        exhausted = true;
        skipped.set(lc.case.id, (skipped.get(lc.case.id) ?? 0) + 1);
        continue;
      }
      await opts.beforeTrial?.(lc, trial);
      const { record, failure } = await execute(opts.client, lc, trial, opts.approvals?.(lc) ?? []);
      const t = trialOf(lc.case, trial, record, failure);
      if (t.cost_usd === null) incomplete ||= record !== null;
      else spent += t.cost_usd;
      results.get(lc.case.id)!.push(t);
      opts.onTrial?.(lc, t);
    }
  };
  const workers = opts.beforeTrial ? 1 : Math.max(1, Math.min(opts.concurrency, tasks.length));
  await Promise.all(Array.from({ length: workers }, worker));

  const cases = opts.cases.map((lc): CaseResult => {
    const trials = results.get(lc.case.id)!.sort((a, b) => a.trial - b.trial);
    return {
      id: lc.case.id,
      suite: lc.case.suite,
      category: lc.case.category,
      severity: lc.case.severity,
      trust: lc.case.trust,
      sha256: lc.sha256,
      pass_policy: lc.case.pass,
      trials,
      skipped: skipped.get(lc.case.id) ?? 0,
      passed: casePassed(lc.case.pass, trials) && (skipped.get(lc.case.id) ?? 0) === 0,
    };
  });
  return {
    cases,
    spent_usd: spent,
    cost_incomplete: incomplete,
    budget_exhausted: exhausted,
    wall_ms: Date.now() - started,
  };
}
