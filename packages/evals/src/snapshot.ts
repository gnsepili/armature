import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "@armature/arc";
import { ArmatureError, ExitCode, LOCK_FILE, type ProjectPlan } from "@armature/core";
import type { Check } from "./grade.ts";
import { GRADERS_VERSION, outputText } from "./grade.ts";
import type { LoadedSuite } from "./load.ts";
import { type Gate, gatesPassed, type Summary } from "./metrics.ts";
import type { CaseResult, RunOutcome } from "./run.ts";

/** A run's full snapshot: what ran, against what, and how it scored. */

export const RUNS_DIR = "evals/runs";

export interface TrialSnapshot {
  trial: number;
  run_id: string | null;
  status: string | null;
  passed: boolean;
  score: number;
  failure: { kind: string; message: string } | null;
  failed_checks: Check[];
  not_measured: string[];
  cost_usd: number | null;
  latency_ms: number | null;
  steps: number | null;
  tool_calls: Array<{
    name: string;
    args: unknown;
    status: string;
    approval: string;
    stubbed: boolean;
    error?: string | null;
  }>;
  output: string;
}

export interface CaseSnapshot {
  id: string;
  category: string;
  severity: string;
  trust: string;
  sha256: string;
  passed: boolean;
  skipped: number;
  trials: TrialSnapshot[];
}

export interface RunSnapshot {
  schema_version: 1;
  run_id: string;
  suite: string;
  label: "MOCK" | "LIVE";
  started_at: string;
  wall_ms: number;
  banners: string[];
  aggregate_only: boolean;
  project: {
    name: string;
    framework: string;
    pattern: string;
    template_version: string | null;
    code_sha256: string;
    prompt_sha256: string;
    tool_schema_sha256: string;
    manifest_sha256: string;
  };
  model: { provider: string; id: string; temperature: number | null; max_output_tokens: number | null };
  dataset: {
    sha256: string;
    cases: number;
    sample: { n: number; seed: number } | null;
    case_filter: string[] | null;
    benchmark: "frozen" | "changed" | "unfrozen";
  };
  graders_version: string;
  trials_per_case: number;
  budget_usd: number;
  spent_usd: number;
  cost_incomplete: boolean;
  summary: Summary;
  gates: Gate[];
  passed: boolean;
  /** Null in the repo copy of aggregate-only suites. */
  cases: CaseSnapshot[] | null;
}

const sha = (h: ReturnType<typeof createHash>) => h.digest("hex");

function walk(dir: string, prefix = ""): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name === "__pycache__" || name === ".DS_Store" || name.endsWith(".pyc")) continue;
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/** Hash of the listed files and directories (relative paths and contents, CRLF-normalized). */
export function hashPaths(dir: string, paths: string[]): string {
  const h = createHash("sha256");
  for (const p of paths) {
    const full = join(dir, p);
    if (!existsSync(full)) continue;
    const files = statSync(full).isDirectory() ? walk(full).map((f) => `${p}/${f}`) : [p];
    for (const f of files) {
      h.update(`${f}\0`);
      h.update(readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n"));
      h.update("\0");
    }
  }
  return sha(h);
}

const hashJson = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

function templateVersion(dir: string): string | null {
  try {
    return (
      (JSON.parse(readFileSync(join(dir, LOCK_FILE), "utf8")) as { template_version?: string })
        .template_version ?? null
    );
  } catch {
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

export function newRunId(dir: string, suite: string, now = new Date()): string {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const base = `${stamp}-${suite}`;
  let id = base;
  for (let n = 2; existsSync(join(dir, RUNS_DIR, id)); n++) id = `${base}-${n}`;
  return id;
}

function caseSnapshot(c: CaseResult): CaseSnapshot {
  return {
    id: c.id,
    category: c.category,
    severity: c.severity,
    trust: c.trust,
    sha256: c.sha256,
    passed: c.passed,
    skipped: c.skipped,
    trials: c.trials.map((t) => {
      const out = outputText(t.record);
      return {
        trial: t.trial,
        run_id: t.run_id,
        status: t.status,
        passed: t.grade.passed,
        score: t.grade.score,
        failure: t.failure,
        failed_checks: t.grade.checks.filter((x) => x.status === "fail"),
        not_measured: t.grade.checks.filter((x) => x.status === "not_measured").map((x) => x.name),
        cost_usd: t.cost_usd,
        latency_ms: t.latency_ms,
        steps: t.steps,
        tool_calls: (t.record?.tool_calls ?? []).map((x) => ({
          name: x.name,
          args: x.args,
          status: x.status,
          approval: x.approval,
          stubbed: x.stubbed,
          ...(x.error ? { error: x.error } : {}),
        })),
        output: out.length > 4000 ? `${out.slice(0, 4000)}...` : out,
      };
    }),
  };
}

export function buildSnapshot(opts: {
  dir: string;
  runId: string;
  suite: LoadedSuite;
  label: "MOCK" | "LIVE";
  startedAt: Date;
  plan: ProjectPlan;
  manifest: Manifest;
  outcome: RunOutcome;
  summary: Summary;
  gates: Gate[];
  trials: number;
  budgetUsd: number;
  sample: { n: number; seed: number } | null;
  caseFilter: string[] | null;
  benchmark: RunSnapshot["dataset"]["benchmark"];
}): RunSnapshot {
  const { plan, outcome, summary } = opts;
  const pkg = `src/${plan.package}`;
  const banners: string[] = [];
  if (opts.label === "MOCK") banners.push("MOCK: offline run on the mock model; checks wiring, not quality");
  if (summary.basis === "DRAFT") banners.push("DRAFT: no VERIFIED cases; scores are drafts and do not gate");
  else if (summary.drafts) banners.push(`DRAFT: ${summary.drafts} unverified case(s) excluded from scores`);
  if (opts.benchmark === "changed") banners.push("BENCHMARK CHANGED: cases differ from evals/benchmark.lock");
  if (opts.sample || opts.caseFilter)
    banners.push("SAMPLED: a subset of the suite; not comparable to full runs");
  if (outcome.budget_exhausted) banners.push("BUDGET: the cost limit stopped the run early");
  return {
    schema_version: 1,
    run_id: opts.runId,
    suite: opts.suite.name,
    label: opts.label,
    started_at: opts.startedAt.toISOString(),
    wall_ms: outcome.wall_ms,
    banners,
    aggregate_only: opts.suite.config.report === "aggregate_only",
    project: {
      name: plan.name,
      framework: plan.framework,
      pattern: plan.pattern,
      template_version: templateVersion(opts.dir),
      code_sha256: hashPaths(opts.dir, ["src", "armature.yaml", "pyproject.toml", "uv.lock"]),
      prompt_sha256: hashPaths(opts.dir, [`${pkg}/prompts`]),
      tool_schema_sha256: hashJson(
        opts.manifest.tools.map((t) => [t.name, t.input_schema, t.side_effect, t.requires_approval]),
      ),
      manifest_sha256: hashJson(opts.manifest),
    },
    model: {
      provider: opts.manifest.model.provider,
      id: opts.manifest.model.id,
      temperature: plan.model.temperature,
      max_output_tokens: plan.model.max_output_tokens,
    },
    dataset: {
      sha256: hashJson(outcome.cases.map((c) => [c.id, c.sha256])),
      cases: outcome.cases.length,
      sample: opts.sample,
      case_filter: opts.caseFilter,
      benchmark: opts.benchmark,
    },
    graders_version: GRADERS_VERSION,
    trials_per_case: opts.trials,
    budget_usd: opts.budgetUsd,
    spent_usd: outcome.spent_usd,
    cost_incomplete: outcome.cost_incomplete,
    summary,
    gates: opts.gates,
    passed: gatesPassed(opts.gates),
    cases: outcome.cases.map(caseSnapshot),
  };
}

/** Writes evals/runs/<id>/run.json and report.md; aggregate-only details go outside the repo. */
export function writeSnapshot(
  dir: string,
  snap: RunSnapshot,
  suite: LoadedSuite,
  report: (s: RunSnapshot) => string,
): string {
  const runDir = join(dir, RUNS_DIR, snap.run_id);
  mkdirSync(runDir, { recursive: true });
  let repoCopy = snap;
  if (snap.aggregate_only) {
    const privateDir = join(suite.dir, "runs");
    mkdirSync(privateDir, { recursive: true });
    writeFileSync(join(privateDir, `${snap.run_id}.json`), `${JSON.stringify(snap, null, 2)}\n`);
    repoCopy = { ...snap, cases: null };
  }
  writeFileSync(join(runDir, "run.json"), `${JSON.stringify(repoCopy, null, 2)}\n`);
  writeFileSync(join(runDir, "report.md"), report(repoCopy));
  return runDir;
}

export function listRuns(dir: string): string[] {
  try {
    return readdirSync(join(dir, RUNS_DIR))
      .filter((n) => existsSync(join(dir, RUNS_DIR, n, "run.json")))
      .sort();
  } catch {
    return [];
  }
}

export function readSnapshot(dir: string, ref: string): RunSnapshot {
  const runs = listRuns(dir);
  let id = ref;
  if (ref === "latest" || ref === "") {
    const last = runs.at(-1);
    if (!last)
      throw new ArmatureError(
        `no eval runs in ${join(dir, RUNS_DIR)}`,
        ExitCode.validation,
        "run `armature eval run` first",
      );
    id = last;
  } else if (!runs.includes(ref)) {
    const matches = runs.filter((r) => r.startsWith(ref) || r.includes(ref));
    if (matches.length !== 1)
      throw new ArmatureError(
        matches.length ? `"${ref}" matches ${matches.length} runs: ${matches.join(", ")}` : `no run "${ref}"`,
        ExitCode.validation,
        runs.length ? `runs: ${runs.slice(-5).join(", ")}` : undefined,
      );
    id = matches[0]!;
  }
  return JSON.parse(readFileSync(join(dir, RUNS_DIR, id, "run.json"), "utf8")) as RunSnapshot;
}

/** The full snapshot of an aggregate-only run, from outside the repo. */
export function readPrivateSnapshot(suite: LoadedSuite, runId: string): RunSnapshot | null {
  const path = join(suite.dir, "runs", `${runId}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as RunSnapshot) : null;
}
