import type { RunRecord } from "@armature/arc";
import { type EvalCase, type Grader, P0_GRADERS } from "@armature/schema";

/**
 * Deterministic graders. Each grader yields one or more checks; a check is pass, fail or
 * not_measured. Graders the P0 runner cannot execute (state, judge, custom) and measurements
 * the run did not record (unknown cost) are NOT_MEASURED, never guessed.
 */

export const GRADERS_VERSION = "1";

export type CheckStatus = "pass" | "fail" | "not_measured";

export interface Check {
  grader: number;
  type: Grader["type"];
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface TrialGrade {
  passed: boolean;
  /** Weighted share of measured graders that passed, 0..1. */
  score: number;
  checks: Check[];
  /** True when at least one grader produced a measurement. */
  measured: boolean;
}

export function outputText(record: RunRecord | null): string {
  if (!record) return "";
  const out = record.output;
  if (out === null || out === undefined) return "";
  return typeof out === "string" ? out : JSON.stringify(out);
}

/** A small JSON Schema subset: type, required, properties, items, enum, const. */
export function matchesSchema(value: unknown, schema: Record<string, unknown>, path = "$"): string | null {
  const type = schema.type;
  if (typeof type === "string") {
    const actual = Array.isArray(value)
      ? "array"
      : value === null
        ? "null"
        : typeof value === "number" && Number.isInteger(value) && type === "integer"
          ? "integer"
          : typeof value;
    if (!(actual === type || (type === "number" && actual === "integer")))
      return `${path} is ${actual}, expected ${type}`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    return `${path} is not one of the allowed values`;
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value))
    return `${path} differs from const`;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? [])
      if (!(key in obj)) return `${path}.${key} is required`;
    const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
    for (const [key, sub] of Object.entries(props))
      if (key in obj) {
        const err = matchesSchema(obj[key], sub, `${path}.${key}`);
        if (err) return err;
      }
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === "object")
    for (let i = 0; i < value.length; i++) {
      const err = matchesSchema(value[i], schema.items as Record<string, unknown>, `${path}[${i}]`);
      if (err) return err;
    }
  return null;
}

function outputChecks(
  g: Extract<Grader, { type: "output" }>,
  index: number,
  record: RunRecord | null,
): Check[] {
  const text = outputText(record);
  const norm = (s: string) => (g.case_sensitive ? s : s.toLowerCase());
  const hay = norm(text);
  const has = (s: string) => hay.includes(norm(s));
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) =>
    checks.push({
      grader: index,
      type: "output",
      name,
      status: ok ? "pass" : "fail",
      ...(ok ? {} : { detail }),
    });
  const preview = JSON.stringify(text.length > 120 ? `${text.slice(0, 117)}...` : text);
  if (g.not_empty) add("not_empty", text.trim().length > 0, "the output is empty");
  if (g.equals !== undefined) add("equals", norm(text.trim()) === norm(g.equals.trim()), `got ${preview}`);
  if (g.contains_any)
    add("contains_any", g.contains_any.some(has), `none of ${JSON.stringify(g.contains_any)} in ${preview}`);
  if (g.contains_all) {
    const missing = g.contains_all.filter((s) => !has(s));
    add("contains_all", missing.length === 0, `missing ${JSON.stringify(missing)}`);
  }
  if (g.not_contains) {
    const found = g.not_contains.filter(has);
    add("not_contains", found.length === 0, `contains ${JSON.stringify(found)}`);
  }
  if (g.regex !== undefined) {
    let ok = false;
    try {
      ok = new RegExp(g.regex, g.case_sensitive ? "" : "i").test(text);
    } catch {
      ok = false;
    }
    add("regex", ok, `/${g.regex}/ does not match ${preview}`);
  }
  if (g.json_schema) {
    let value: unknown = record?.output;
    if (typeof value === "string")
      try {
        value = JSON.parse(value);
      } catch {}
    const err = matchesSchema(value, g.json_schema);
    add("json_schema", err === null, err ?? undefined);
  }
  return checks;
}

function constraintChecks(
  g: Extract<Grader, { type: "constraint" }>,
  index: number,
  record: RunRecord | null,
): Check[] {
  const calls = record?.tool_calls ?? [];
  const called = new Set(calls.map((c) => c.name));
  const checks: Check[] = [];
  const add = (name: string, status: CheckStatus, detail?: string) =>
    checks.push({
      grader: index,
      type: "constraint",
      name,
      status,
      ...(status === "pass" ? {} : { detail }),
    });
  const ok = (b: boolean) => (b ? "pass" : "fail");
  if (g.no_run_error)
    add(
      "no_run_error",
      ok(record !== null && record.status !== "error"),
      record?.error
        ? `${record.error.code}: ${record.error.message}`
        : record
          ? `status ${record.status}`
          : "no run",
    );
  if (g.never_call) {
    const bad = g.never_call.filter((n) => called.has(n));
    add("never_call", ok(bad.length === 0), `called ${bad.join(", ")}`);
  }
  if (g.must_call_any)
    add(
      "must_call_any",
      ok(g.must_call_any.some((n) => called.has(n))),
      `called none of ${g.must_call_any.join(", ")}${called.size ? ` (called ${[...called].join(", ")})` : ""}`,
    );
  if (g.approval_before) {
    const gated = calls.filter((c) => g.approval_before!.includes(c.name));
    const bad = gated.filter((c) => c.approval !== "approved");
    add(
      "approval_before",
      ok(bad.length === 0),
      bad.map((c) => `${c.name} ran with approval ${c.approval}`).join("; "),
    );
  }
  if (g.max_steps !== undefined) {
    const steps = record?.usage.model_calls;
    if (steps === undefined) add("max_steps", "not_measured", "no usage recorded");
    else add("max_steps", ok(steps <= g.max_steps), `${steps} model calls > ${g.max_steps}`);
  }
  if (g.max_tool_calls !== undefined)
    add(
      "max_tool_calls",
      ok(calls.length <= g.max_tool_calls),
      `${calls.length} tool calls > ${g.max_tool_calls}`,
    );
  if (g.max_cost_usd !== undefined) {
    const cost = record?.usage.cost_usd;
    if (cost === null || cost === undefined)
      add("max_cost_usd", "not_measured", "cost unknown for this model");
    else add("max_cost_usd", ok(cost <= g.max_cost_usd), `$${cost.toFixed(4)} > $${g.max_cost_usd}`);
  }
  if (g.max_latency_ms !== undefined) {
    const ms = record?.duration_ms;
    if (ms === null || ms === undefined) add("max_latency_ms", "not_measured", "no duration recorded");
    else add("max_latency_ms", ok(ms <= g.max_latency_ms), `${Math.round(ms)}ms > ${g.max_latency_ms}ms`);
  }
  return checks;
}

export function gradeTrial(c: EvalCase, record: RunRecord | null): TrialGrade {
  const checks: Check[] = [];
  let total = 0;
  let earned = 0;
  c.graders.forEach((g, i) => {
    let own: Check[];
    if (!P0_GRADERS.has(g.type))
      own = [
        {
          grader: i,
          type: g.type,
          name: g.type,
          status: "not_measured",
          detail: "grader not available in P0",
        },
      ];
    else if (g.type === "output") own = outputChecks(g, i, record);
    else if (g.type === "constraint") own = constraintChecks(g, i, record);
    else own = [];
    if (own.length === 0)
      own = [
        { grader: i, type: g.type, name: "empty", status: "not_measured", detail: "grader has no checks" },
      ];
    checks.push(...own);
    const measured = own.filter((x) => x.status !== "not_measured");
    if (measured.length === 0) return;
    total += g.weight;
    if (measured.every((x) => x.status === "pass")) earned += g.weight;
  });
  const measured = checks.some((x) => x.status !== "not_measured");
  const passed = measured && checks.every((x) => x.status !== "fail");
  return { passed, score: total ? earned / total : 0, checks, measured };
}

/** Grader checks that exist without a run, used by lint to spot graders with no checks. */
export function graderCheckCount(g: Grader): number {
  if (g.type === "output")
    return [
      "equals",
      "contains_any",
      "contains_all",
      "not_contains",
      "regex",
      "json_schema",
      "not_empty",
    ].filter(
      (k) => (g as Record<string, unknown>)[k] !== undefined && (g as Record<string, unknown>)[k] !== false,
    ).length;
  if (g.type === "constraint")
    return [
      "never_call",
      "must_call_any",
      "approval_before",
      "max_steps",
      "max_tool_calls",
      "max_cost_usd",
      "max_latency_ms",
      "no_run_error",
    ].filter(
      (k) => (g as Record<string, unknown>)[k] !== undefined && (g as Record<string, unknown>)[k] !== false,
    ).length;
  return 1;
}
