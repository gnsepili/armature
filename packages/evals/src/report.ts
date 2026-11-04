import { DIMENSIONS, type Measured, NOT_MEASURED } from "./metrics.ts";
import type { RunSnapshot } from "./snapshot.ts";

/** Markdown and terminal renderings of a run snapshot. */

export const pct = (v: Measured): string =>
  typeof v === "number" ? `${(v * 100).toFixed(1)}%` : NOT_MEASURED;
const num = (v: Measured, digits = 1): string => (typeof v === "number" ? v.toFixed(digits) : NOT_MEASURED);
const usd = (v: Measured): string => (typeof v === "number" ? `$${v.toFixed(4)}` : NOT_MEASURED);
const ms = (v: Measured): string => (typeof v === "number" ? `${Math.round(v)} ms` : NOT_MEASURED);
const ci = (c: [number, number] | null): string =>
  c ? ` (95% CI ${(c[0] * 100).toFixed(1)}-${(c[1] * 100).toFixed(1)}%)` : " (CI needs 10+ cases)";

function headline(s: RunSnapshot): string[] {
  const m = s.summary;
  const basis =
    m.basis === "VERIFIED" ? `${m.verified} verified` : m.basis === "DRAFT" ? `${m.cases} DRAFT` : "no";
  return [
    `Task success: ${pct(m.task_success)}${ci(m.task_success_ci)} over ${basis} case(s)`,
    `pass@1 ${pct(m.pass_at_1)} · pass@${m.k} ${pct(m.pass_at_k)} · pass^${m.k} ${pct(m.pass_pow_k)} · ${m.trials} trial(s)`,
    ...(m.basis === "VERIFIED" && m.drafts
      ? [`Drafts (not scored): ${pct(m.draft_task_success)} of ${m.drafts}`]
      : []),
    `Cost/task ${usd(m.cost_per_task_usd)} · p50 ${ms(m.latency_p50_ms)} · p95 ${ms(m.latency_p95_ms)} · steps/task ${num(m.steps_per_task)} · tool errors/task ${num(m.tool_errors_per_task, 2)}`,
  ];
}

export function renderMarkdown(s: RunSnapshot): string {
  const m = s.summary;
  const lines: string[] = [];
  lines.push(`# Eval run ${s.run_id}`, "");
  for (const b of s.banners) lines.push(`> **${b}**`);
  if (s.banners.length) lines.push("");
  lines.push(
    `- Suite: \`${s.suite}\` (${s.label}) · ${s.project.framework} · ${s.model.provider}/${s.model.id}`,
    `- Result: **${s.passed ? "PASS" : "FAIL"}** · ${s.summary.cases} case(s) · ${(s.wall_ms / 1000).toFixed(1)} s · $${s.spent_usd.toFixed(4)}${s.cost_incomplete ? " (lower bound)" : ""}`,
    `- Code ${s.project.code_sha256.slice(0, 12)} · prompt ${s.project.prompt_sha256.slice(0, 12)} · tools ${s.project.tool_schema_sha256.slice(0, 12)} · dataset ${s.dataset.sha256.slice(0, 12)} · graders v${s.graders_version}`,
    "",
    "## Summary",
    "",
    ...headline(s).map((l) => `- ${l}`),
    "",
    "## Gates",
    "",
    "| Gate | Result | Detail |",
    "| --- | --- | --- |",
    ...s.gates.map(
      (g) => `| ${g.name} | ${g.passed ? "pass" : "**FAIL**"} | ${g.detail.replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## Dimensions",
    "",
    "| Dimension | Score |",
    "| --- | --- |",
    ...DIMENSIONS.map((d) => `| ${d} | ${pct(m.dimensions[d])} |`),
    "",
  );
  const cats = Object.entries(m.by_category).sort(([a], [b]) => (a < b ? -1 : 1));
  if (cats.length)
    lines.push(
      "## By category",
      "",
      "| Category | Passed |",
      "| --- | --- |",
      ...cats.map(([k, r]) => `| ${k} | ${r.passed}/${r.cases} |`),
      "",
    );
  if (s.cases === null) {
    lines.push("Per-case results are not kept in the repo for this suite (aggregate only).", "");
    return `${lines.join("\n")}\n`;
  }
  const failed = s.cases.filter((c) => !c.passed);
  lines.push("## Failures", "");
  if (!failed.length) lines.push("None.", "");
  for (const c of failed) {
    lines.push(`### ${c.id} (${c.category}, ${c.severity}, ${c.trust})`, "");
    if (c.skipped) lines.push(`- ${c.skipped} trial(s) skipped by the budget`);
    for (const t of c.trials.filter((x) => !x.passed)) {
      const why = t.failure
        ? `${t.failure.kind}: ${t.failure.message}`
        : t.failed_checks.map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`).join("; ") ||
          `nothing measured: ${t.not_measured.join(", ")}`;
      lines.push(`- Trial ${t.trial}${t.run_id ? ` \`${t.run_id}\`` : ""}: ${why}`);
      if (t.tool_calls.length)
        lines.push(`  - Tools: ${t.tool_calls.map((x) => `${x.name}[${x.status}]`).join(", ")}`);
      if (t.output) lines.push(`  - Output: ${JSON.stringify(t.output.slice(0, 300))}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/** Short terminal summary. */
export function renderTerminal(s: RunSnapshot): string {
  const lines: string[] = [];
  for (const b of s.banners) lines.push(`! ${b}`);
  lines.push(`${s.suite} · ${s.label} · run ${s.run_id}`);
  lines.push(...headline(s).map((l) => `  ${l}`));
  for (const g of s.gates) lines.push(`  ${g.passed ? "ok  " : "FAIL"} ${g.name}: ${g.detail}`);
  if (s.cases) {
    const failed = s.cases.filter((c) => !c.passed);
    if (failed.length) lines.push(`  failed cases: ${failed.map((c) => c.id).join(", ")}`);
  }
  lines.push(s.passed ? "PASS" : "FAIL");
  return lines.join("\n");
}
