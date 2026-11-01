import { type EvalCase, REFUSAL_CATEGORIES } from "@armature/schema";
import { graderCheckCount } from "./grade.ts";
import { type Benchmark, firstUserText, type Issue } from "./load.ts";

/** Static checks on the benchmark: no app, no model, no network. */

export interface LintContext {
  tools: Array<{ name: string; description: string; side_effect: string }>;
  /** System prompt and tool descriptions, checked for overlap with case wording. */
  agentText: string;
}

const SHINGLE = 8;

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function shingles(text: string, n = SHINGLE): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

function caseText(c: EvalCase): string[] {
  const parts: string[] = [];
  if (typeof c.input === "string") parts.push(c.input);
  else for (const m of c.input) parts.push(m.content);
  if (c.expected_outcome) parts.push(c.expected_outcome);
  for (const g of c.graders)
    if (g.type === "output") {
      if (g.equals) parts.push(g.equals);
      for (const s of [...(g.contains_all ?? []), ...(g.contains_any ?? [])]) parts.push(s);
    }
  return parts;
}

function toolNames(c: EvalCase): string[] {
  const names: string[] = [];
  for (const g of c.graders)
    if (g.type === "constraint")
      names.push(...(g.never_call ?? []), ...(g.must_call_any ?? []), ...(g.approval_before ?? []));
  names.push(...Object.keys(c.stubs ?? {}));
  return names;
}

/** Graders that cannot tell a good answer from a bad one. */
function isWeak(c: EvalCase): boolean {
  if (REFUSAL_CATEGORIES.has(c.category) || c.suite === "smoke") return false;
  return !c.graders.some((g) => {
    if (g.type === "output")
      return Boolean(g.equals || g.contains_all || g.contains_any || g.regex || g.json_schema);
    if (g.type === "constraint") return Boolean(g.must_call_any || g.never_call || g.approval_before);
    return g.type !== "judge";
  });
}

export function lintBenchmark(bench: Benchmark, ctx: LintContext): Issue[] {
  const issues: Issue[] = [];
  const known = new Set(ctx.tools.map((t) => t.name));
  const agentShingles = shingles(ctx.agentText);
  const inputs = new Map<string, string>();

  for (const suite of bench.suites.values()) {
    for (const { case: c, path, reference } of suite.cases) {
      const at = { case: c.id, path };
      if ((c.category === "prohibited_action" || c.category === "adversarial") && c.severity !== "critical")
        issues.push({ level: "error", ...at, message: `${c.category} cases must be severity critical` });
      c.graders.forEach((g, i) => {
        if (graderCheckCount(g) === 0)
          issues.push({ level: "error", ...at, message: `grader ${i} (${g.type}) checks nothing` });
        if (g.type === "output" && g.regex !== undefined)
          try {
            new RegExp(g.regex);
          } catch {
            issues.push({ level: "error", ...at, message: `grader ${i} has an invalid regex /${g.regex}/` });
          }
      });
      for (const name of new Set(toolNames(c)))
        if (!known.has(name)) issues.push({ level: "error", ...at, message: `unknown tool "${name}"` });
      if (reference)
        for (const step of reference.steps)
          if ("tool_calls" in step)
            for (const call of step.tool_calls)
              if (!known.has(call.name))
                issues.push({
                  level: "error",
                  ...at,
                  message: `reference calls unknown tool "${call.name}"`,
                });
      if (isWeak(c))
        issues.push({
          level: "warning",
          ...at,
          message:
            "graders only check that the run finished; add an outcome check (contains_any, equals, regex)",
        });
      if (!reference && suite.config.mode !== "offline")
        issues.push({
          level: "warning",
          ...at,
          message: "no reference trajectory, so validate cannot prove the case is passable",
        });
      const input = firstUserText(c).toLowerCase();
      const dup = inputs.get(input);
      if (dup && dup !== c.id) issues.push({ level: "warning", ...at, message: `same input as ${dup}` });
      else inputs.set(input, c.id);
      // Overlap with the agent's own text suggests the prompt was tuned to this case.
      if (agentShingles.size)
        for (const text of caseText(c)) {
          const hit = [...shingles(text)].find((s) => agentShingles.has(s));
          if (hit) {
            issues.push({
              level: "warning",
              ...at,
              message: `case wording appears in the system prompt or tool descriptions: "${hit}"`,
            });
            break;
          }
        }
    }
  }

  const dev = bench.suites.get("dev");
  if (dev?.exists) {
    const n = dev.cases.length;
    if (n < bench.spec.min_dev_cases)
      issues.push({
        level: "warning",
        message: `dev has ${n} cases; the target is at least ${bench.spec.min_dev_cases}`,
      });
    const shouldNot = dev.cases.filter(
      (x) => REFUSAL_CATEGORIES.has(x.case.category) || x.case.category === "ambiguous",
    ).length;
    const should = n - shouldNot;
    if (n >= 4 && (should === 0 || shouldNot === 0 || Math.min(should, shouldNot) / n < 0.2))
      issues.push({
        level: "warning",
        message: `dev has ${should} should-act and ${shouldNot} should-not cases; aim for at least 20% of each`,
      });
  }
  return issues;
}
