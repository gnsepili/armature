import { ArmatureError, ExitCode } from "@armature/core";
import type { EvalSpec } from "@armature/schema";
import type { Gate } from "./metrics.ts";
import type { CaseSnapshot, RunSnapshot } from "./snapshot.ts";
import { fisherExact, mean, pairedBootstrapCi } from "./stats.ts";

/**
 * Compares two runs of one suite case by case. Only cases present in both with the same hash
 * count; a case moves only when Fisher's exact test on its trials says so (p <= 0.1), so
 * single-trial flips read as noise.
 */

export const SIGNIFICANCE = 0.1;

export type Verdict = "improved" | "regressed" | "within_noise" | "unchanged";

export interface CaseDelta {
  id: string;
  severity: string;
  a: { passes: number; trials: number };
  b: { passes: number; trials: number };
  p_value: number;
  verdict: Verdict;
}

export interface Comparison {
  a: string;
  b: string;
  suite: string;
  label: "MOCK" | "LIVE";
  common: number;
  excluded: { changed: string[]; only_a: string[]; only_b: string[] };
  /** Mean per-case pass rate over common VERIFIED cases (all common cases when none are). */
  basis: "VERIFIED" | "DRAFT";
  a_rate: number | null;
  b_rate: number | null;
  delta: number | null;
  delta_ci: [number, number] | null;
  cases: CaseDelta[];
  changed: { code: boolean; prompt: boolean; tools: boolean; model: boolean };
  gates: Gate[];
}

const passes = (c: CaseSnapshot) => c.trials.filter((t) => t.passed).length;

export function compareRuns(a: RunSnapshot, b: RunSnapshot, spec: EvalSpec): Comparison {
  if (a.suite !== b.suite)
    throw new ArmatureError(`runs are of different suites (${a.suite} vs ${b.suite})`, ExitCode.validation);
  if (a.label !== b.label)
    throw new ArmatureError(
      `cannot compare a ${a.label} run with a ${b.label} run`,
      ExitCode.validation,
      "MOCK runs check wiring, not quality; compare runs of the same kind",
    );
  if (!a.cases || !b.cases)
    throw new ArmatureError(
      "per-case results are not in the repo for this suite",
      ExitCode.validation,
      "pass --reveal to read them from the held-out directory",
    );
  const byId = new Map(a.cases.map((c) => [c.id, c]));
  const bIds = new Set(b.cases.map((c) => c.id));
  const excluded: Comparison["excluded"] = {
    changed: [],
    only_a: a.cases.filter((c) => !bIds.has(c.id)).map((c) => c.id),
    only_b: [],
  };
  const pairs: Array<[CaseSnapshot, CaseSnapshot]> = [];
  for (const cb of b.cases) {
    const ca = byId.get(cb.id);
    if (!ca) excluded.only_b.push(cb.id);
    else if (ca.sha256 !== cb.sha256) excluded.changed.push(cb.id);
    else if (ca.trials.length && cb.trials.length) pairs.push([ca, cb]);
  }
  const verifiedPairs = pairs.filter(([ca, cb]) => ca.trust === "VERIFIED" && cb.trust === "VERIFIED");
  const basisPairs = verifiedPairs.length ? verifiedPairs : pairs;

  const cases: CaseDelta[] = pairs.map(([ca, cb]) => {
    const pa = passes(ca);
    const pb = passes(cb);
    const p = fisherExact(pa, ca.trials.length - pa, pb, cb.trials.length - pb);
    const ra = pa / ca.trials.length;
    const rb = pb / cb.trials.length;
    const verdict: Verdict =
      ra === rb ? "unchanged" : p > SIGNIFICANCE ? "within_noise" : rb > ra ? "improved" : "regressed";
    return {
      id: cb.id,
      severity: cb.severity,
      a: { passes: pa, trials: ca.trials.length },
      b: { passes: pb, trials: cb.trials.length },
      p_value: p,
      verdict,
    };
  });

  const ar = basisPairs.map(([ca]) => passes(ca) / ca.trials.length);
  const br = basisPairs.map(([, cb]) => passes(cb) / cb.trials.length);
  const aRate = ar.length ? mean(ar) : null;
  const bRate = br.length ? mean(br) : null;
  const delta = aRate !== null && bRate !== null ? bRate - aRate : null;
  const deltaCi = pairedBootstrapCi(ar, br);
  const basis = verifiedPairs.length ? "VERIFIED" : "DRAFT";

  const gates: Gate[] = [];
  if (basis === "VERIFIED") {
    const max = spec.gates.max_task_success_regression;
    // Regression counts only when the interval excludes "no worse than the allowance".
    const sure = deltaCi ? deltaCi[1] < -max : delta !== null && delta < -max;
    gates.push({
      name: "max_task_success_regression",
      passed: !sure,
      detail:
        delta === null
          ? "no common cases"
          : `${(delta * 100).toFixed(1)} pts${deltaCi ? ` (95% CI ${(deltaCi[0] * 100).toFixed(1)} to ${(deltaCi[1] * 100).toFixed(1)})` : ""}; allowed -${(max * 100).toFixed(1)}`,
    });
    const verifiedIds = new Set(verifiedPairs.map(([, cb]) => cb.id));
    const critical = cases.filter(
      (d) =>
        d.severity === "critical" &&
        verifiedIds.has(d.id) &&
        d.b.passes < d.b.trials &&
        d.a.passes === d.a.trials,
    );
    gates.push({
      name: "critical_regressions",
      passed: critical.length === 0,
      detail: critical.length
        ? `newly failing: ${critical.map((d) => d.id).join(", ")}`
        : "no critical case newly failing",
    });
  }
  return {
    a: a.run_id,
    b: b.run_id,
    suite: a.suite,
    label: a.label,
    common: pairs.length,
    excluded,
    basis,
    a_rate: aRate,
    b_rate: bRate,
    delta,
    delta_ci: deltaCi,
    cases,
    changed: {
      code: a.project.code_sha256 !== b.project.code_sha256,
      prompt: a.project.prompt_sha256 !== b.project.prompt_sha256,
      tools: a.project.tool_schema_sha256 !== b.project.tool_schema_sha256,
      model: a.model.provider !== b.model.provider || a.model.id !== b.model.id,
    },
    gates,
  };
}

export function renderComparison(c: Comparison): string {
  const p = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const lines = [`${c.suite} · ${c.label} · ${c.a} -> ${c.b}`];
  if (c.label === "MOCK")
    lines.push("! MOCK: both runs used the mock model; this compares wiring, not quality");
  if (c.basis === "DRAFT") lines.push("! DRAFT: no common VERIFIED cases; the comparison does not gate");
  const what = Object.entries(c.changed)
    .filter(([, v]) => v)
    .map(([k]) => k);
  lines.push(`  changed: ${what.length ? what.join(", ") : "nothing recorded (A/A run)"}`);
  lines.push(
    `  task success ${p(c.a_rate)} -> ${p(c.b_rate)}${c.delta !== null ? ` (${c.delta >= 0 ? "+" : ""}${(c.delta * 100).toFixed(1)} pts` : ""}${c.delta_ci ? `, 95% CI ${(c.delta_ci[0] * 100).toFixed(1)} to ${(c.delta_ci[1] * 100).toFixed(1)})` : c.delta !== null ? ", CI needs 10+ cases)" : ""} over ${c.common} common case(s)`,
  );
  const ex = c.excluded;
  if (ex.changed.length + ex.only_a.length + ex.only_b.length)
    lines.push(
      `  excluded: ${ex.changed.length} changed, ${ex.only_a.length} only in ${c.a}, ${ex.only_b.length} only in ${c.b}`,
    );
  for (const v of ["regressed", "improved"] as const) {
    const ds = c.cases.filter((d) => d.verdict === v);
    if (ds.length)
      lines.push(
        `  ${v}: ${ds.map((d) => `${d.id} ${d.a.passes}/${d.a.trials}->${d.b.passes}/${d.b.trials} (p=${d.p_value.toFixed(2)})`).join(", ")}`,
      );
  }
  const noise = c.cases.filter((d) => d.verdict === "within_noise").length;
  if (noise) lines.push(`  within noise: ${noise} case(s); add trials to resolve them`);
  for (const g of c.gates) lines.push(`  ${g.passed ? "ok  " : "FAIL"} ${g.name}: ${g.detail}`);
  return lines.join("\n");
}
