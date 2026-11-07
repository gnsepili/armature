import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ArmatureError, ExitCode } from "@armature/core";
import {
  type Benchmark,
  buildSnapshot,
  checkFrozen,
  compareRuns,
  type DynamicResult,
  estimateCost,
  evaluateGates,
  freezeBenchmark,
  gatesPassed,
  type Issue,
  type LoadedCase,
  lintBenchmark,
  loadBenchmark,
  loadEvalSpec,
  loadPlan,
  newRunId,
  type RunSnapshot,
  readPrivateSnapshot,
  readSnapshot,
  renderComparison,
  renderMarkdown,
  renderTerminal,
  runSuite,
  sampleCases,
  startEvalSession,
  summarize,
  validateDynamic,
  writeSnapshot,
} from "@armature/evals";
import { c, type Io, printJson } from "../io.ts";

/** `armature eval validate | run | report | compare | freeze`. */

function intOpt(value: string | undefined, flag: string, min = 1): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min)
    throw new ArmatureError(`${flag} must be an integer >= ${min}, got ${value}`, ExitCode.validation);
  return n;
}

function numOpt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0)
    throw new ArmatureError(`${flag} must be a positive number, got ${value}`, ExitCode.validation);
  return n;
}

function printIssues(io: Io, issues: Issue[]) {
  for (const i of issues) {
    const tag = i.level === "error" ? c.red("error") : c.yellow("warn ");
    const where = i.path ? c.dim(` ${i.path}`) : "";
    io.stderr(`${tag} ${i.case ? `${c.bold(i.case)}: ` : ""}${i.message}${where}\n`);
  }
}

/** The system prompt and tool descriptions, which cases must not copy. */
function agentText(dir: string, pkg: string, tools: Array<{ description: string }>): string {
  const promptDir = join(dir, "src", pkg, "prompts");
  const prompts = existsSync(promptDir)
    ? readdirSync(promptDir)
        .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
        .sort()
        .map((f) => readFileSync(join(promptDir, f), "utf8"))
    : [];
  return [...prompts, ...tools.map((t) => t.description)].join("\n");
}

function lint(dir: string, bench: Benchmark): Issue[] {
  const plan = loadPlan(dir);
  return lintBenchmark(bench, {
    tools: plan.tools.map((t) => ({ name: t.name, description: t.description, side_effect: t.side_effect })),
    agentText: agentText(dir, plan.package, plan.tools),
  });
}

export interface ValidateOptions {
  static?: boolean;
  suite?: string[];
  json?: boolean;
}

export async function evalValidateCommand(
  io: Io,
  dirArg: string | undefined,
  opts: ValidateOptions,
): Promise<number> {
  const dir = resolve(io.cwd, dirArg ?? ".");
  const bench = loadBenchmark(dir, opts.suite?.length ? { suites: opts.suite } : {});
  const issues = [...bench.issues, ...lint(dir, bench)];
  let dynamic: DynamicResult | null = null;
  if (!opts.static && !issues.some((i) => i.level === "error")) {
    const cases = [...bench.suites.values()].flatMap((s) => s.cases);
    const session = await startEvalSession({
      dir,
      offline: true,
      env: io.env,
      caseTimeoutS: bench.spec.run_policy.case_timeout_s,
    });
    try {
      dynamic = await validateDynamic(session, cases);
    } finally {
      await session.stop();
    }
    issues.push(...dynamic.issues);
  }
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const suites = [...bench.suites.values()].map((s) => ({
    name: s.name,
    cases: s.cases.length,
    verified: s.cases.filter((x) => x.case.trust === "VERIFIED").length,
    exists: s.exists,
  }));
  if (opts.json) {
    printJson(io, { ok: errors === 0, suites, issues, dynamic });
    return errors ? ExitCode.validation : ExitCode.ok;
  }
  printIssues(io, issues);
  for (const s of suites)
    io.stdout(
      `  ${s.name.padEnd(10)} ${s.exists ? `${s.cases} case(s), ${s.verified} verified` : c.dim("not found")}\n`,
    );
  if (dynamic)
    io.stdout(
      `  null agent: ${dynamic.null_agent.checked} checked, ${dynamic.null_agent.passing.length} passing (should be 0)\n` +
        `  references: ${dynamic.references.checked} replayed, ${dynamic.references.failing.length} failing\n`,
    );
  else if (opts.static)
    io.stdout(c.dim("  static checks only; drop --static to replay against the mock model\n"));
  io.stdout(
    errors
      ? `${c.red("invalid")} ${errors} error(s), ${warnings} warning(s)\n`
      : `${c.green("valid")} ${warnings ? `${warnings} warning(s)` : "no issues"}\n`,
  );
  return errors ? ExitCode.validation : ExitCode.ok;
}

export interface EvalRunOptions {
  suite?: string;
  case?: string[];
  sample?: string;
  seed?: string;
  trials?: string;
  offline?: boolean;
  maxCost?: string;
  concurrency?: string;
  json?: boolean;
}

export async function evalRunCommand(
  io: Io,
  dirArg: string | undefined,
  opts: EvalRunOptions,
): Promise<number> {
  const dir = resolve(io.cwd, dirArg ?? ".");
  const bench = loadBenchmark(dir);
  const name = opts.suite ?? "dev";
  const suite = bench.suites.get(name);
  if (!suite)
    throw new ArmatureError(
      `no suite "${name}" in evals/evalspec.yaml`,
      ExitCode.validation,
      `suites: ${[...bench.suites.keys()].join(", ") || "none"}`,
    );
  const loadErrors = bench.issues.filter((i) => i.level === "error");
  if (loadErrors.length) {
    if (!opts.json) printIssues(io, loadErrors);
    throw new ArmatureError(
      `the benchmark has ${loadErrors.length} error(s)`,
      ExitCode.validation,
      "run `armature eval validate` for details",
    );
  }
  if (!suite.exists)
    throw new ArmatureError(`suite "${name}" has no directory at ${suite.dir}`, ExitCode.validation);
  const offline = Boolean(opts.offline);
  if (suite.config.mode === "offline" && !offline)
    throw new ArmatureError(`suite "${name}" runs offline only`, ExitCode.validation, "pass --offline");
  if (suite.config.mode === "live" && offline)
    throw new ArmatureError(
      `suite "${name}" runs live only; the mock model cannot score it`,
      ExitCode.validation,
      "drop --offline and set the provider key",
    );

  let cases: LoadedCase[] = suite.cases;
  let caseFilter: string[] | null = null;
  if (opts.case?.length) {
    const ids = new Set(cases.map((x) => x.case.id));
    const unknown = opts.case.filter((id) => !ids.has(id));
    if (unknown.length)
      throw new ArmatureError(`no case ${unknown.join(", ")} in suite "${name}"`, ExitCode.validation);
    caseFilter = [...opts.case].sort();
    cases = cases.filter((x) => opts.case?.includes(x.case.id));
  }
  const sampleN = intOpt(opts.sample, "--sample");
  const seed = intOpt(opts.seed, "--seed", 0) ?? 0;
  let sample: { n: number; seed: number } | null = null;
  if (sampleN !== undefined && sampleN < cases.length) {
    sample = { n: sampleN, seed };
    cases = sampleCases(cases, sampleN, seed);
  }
  if (!cases.length) throw new ArmatureError(`suite "${name}" has no cases to run`, ExitCode.validation);

  const policy = bench.spec.run_policy;
  const trials = intOpt(opts.trials, "--trials") ?? suite.config.trials;
  const budgetUsd = numOpt(opts.maxCost, "--max-cost") ?? policy.max_cost_usd_per_run;
  const concurrency = intOpt(opts.concurrency, "--concurrency") ?? policy.concurrency;
  const say = (s: string) => {
    if (!opts.json) io.stderr(s);
  };

  if (!offline) {
    const estimate = estimateCost(loadPlan(dir), cases, trials);
    say(
      estimate === null
        ? `${c.dim("cost")}  no price for this model; the run stops at $${budgetUsd.toFixed(2)} only if usage reports cost\n`
        : `${c.dim("cost")}  up to ~$${estimate.toFixed(2)} for ${cases.length} case(s) x ${trials} trial(s); limit $${budgetUsd.toFixed(2)}\n`,
    );
  }

  const frozen = checkFrozen(bench);
  const benchmark = frozen === null ? "unfrozen" : frozen.changed ? "changed" : "frozen";
  const startedAt = new Date();
  const session = await startEvalSession({ dir, offline, env: io.env, caseTimeoutS: policy.case_timeout_s });
  let snap: RunSnapshot;
  try {
    let done = 0;
    const total = cases.reduce((n, x) => n + (x.case.trials ?? trials), 0);
    const outcome = await runSuite({
      session,
      cases,
      trials,
      concurrency,
      budgetUsd,
      onTrial: (lc, t) => {
        done++;
        const mark = t.failure ? c.red("err ") : t.grade.passed ? c.green("pass") : c.yellow("fail");
        say(`  ${c.dim(`[${done}/${total}]`)} ${mark} ${lc.case.id}${trials > 1 ? `#${t.trial}` : ""}\n`);
      },
    });
    const summary = summarize(outcome, { seed });
    const gates = evaluateGates({
      suite: name,
      spec: bench.spec,
      outcome,
      summary,
      benchmarkChanged: frozen ? frozen.changed : null,
    });
    snap = buildSnapshot({
      dir,
      runId: newRunId(dir, name, startedAt),
      suite,
      label: session.mode,
      startedAt,
      plan: session.plan,
      manifest: session.manifest,
      outcome,
      summary,
      gates,
      trials,
      budgetUsd,
      sample,
      caseFilter,
      benchmark,
    });
  } finally {
    await session.stop();
  }
  const runDir = writeSnapshot(dir, snap, suite, renderMarkdown);
  if (opts.json) printJson(io, snap.aggregate_only ? { ...snap, cases: null } : snap);
  else {
    io.stdout(`${renderTerminal(snap)}\n`);
    io.stdout(c.dim(`report: ${join(runDir, "report.md")}\n`));
  }
  return gatesPassed(snap.gates) ? ExitCode.ok : ExitCode.evalGateFailed;
}

/** The snapshot, with per-case results from outside the repo when asked and available. */
function loadRun(dir: string, ref: string, reveal: boolean): RunSnapshot {
  const snap = readSnapshot(dir, ref);
  if (!reveal || snap.cases !== null) return snap;
  const suite = loadBenchmark(dir, { suites: [snap.suite] }).suites.get(snap.suite);
  const full = suite ? readPrivateSnapshot(suite, snap.run_id) : null;
  if (!full)
    throw new ArmatureError(
      `no per-case results for ${snap.run_id} outside the repo`,
      ExitCode.validation,
      suite ? `looked in ${join(suite.dir, "runs")}` : `suite "${snap.suite}" is no longer in the evalspec`,
    );
  return full;
}

export interface ReportOptions {
  dir?: string;
  reveal?: boolean;
  json?: boolean;
}

export function evalReportCommand(io: Io, ref: string | undefined, opts: ReportOptions): number {
  const dir = resolve(io.cwd, opts.dir ?? ".");
  const snap = loadRun(dir, ref ?? "latest", Boolean(opts.reveal));
  if (opts.json) printJson(io, snap);
  else io.stdout(renderMarkdown(snap));
  return ExitCode.ok;
}

export function evalCompareCommand(io: Io, a: string, b: string, opts: ReportOptions): number {
  const dir = resolve(io.cwd, opts.dir ?? ".");
  const reveal = Boolean(opts.reveal);
  const cmp = compareRuns(loadRun(dir, a, reveal), loadRun(dir, b, reveal), loadEvalSpec(dir).spec);
  if (opts.json) printJson(io, cmp);
  else io.stdout(`${renderComparison(cmp)}\n`);
  return gatesPassed(cmp.gates) ? ExitCode.ok : ExitCode.evalGateFailed;
}

export function evalFreezeCommand(io: Io, dirArg: string | undefined, opts: { json?: boolean }): number {
  const dir = resolve(io.cwd, dirArg ?? ".");
  const bench = loadBenchmark(dir);
  bench.issues.push(...lint(dir, bench));
  const lock = freezeBenchmark(bench);
  if (opts.json) {
    printJson(io, { ok: true, lock });
    return ExitCode.ok;
  }
  for (const [name, s] of Object.entries(lock.suites))
    io.stdout(`  ${name.padEnd(10)} ${Object.keys(s.cases).length} case(s)\n`);
  for (const [name, s] of Object.entries(lock.private_suites))
    io.stdout(`  ${name.padEnd(10)} ${s.count} case(s), hash only\n`);
  io.stdout(`${c.green("frozen")} evals/benchmark.lock; commit it with the cases\n`);
  return ExitCode.ok;
}
