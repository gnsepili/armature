import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ConformanceReport } from "@armature/arc";
import { ArmatureError, ExitCode, requireVenv } from "@armature/core";
import { c, type Io, printJson, toFailure } from "../io.ts";
import { projectConformance, projectPlan, scaffoldDrift } from "../project.ts";
import { renderConformance } from "./doctor.ts";

export const TEST_PARTS = ["golden", "unit", "conformance"] as const;
export type TestPart = (typeof TEST_PARTS)[number];

export interface TestOptions {
  only?: string[];
  json?: boolean;
}

export interface PartResult {
  part: TestPart;
  passed: boolean;
  summary: string;
  details: string[];
  duration_ms: number;
}

function pytest(
  python: string,
  dir: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; output: string }> {
  return new Promise((ok, fail) => {
    const child = spawn(python, ["-m", "pytest", "-q", "-p", "no:cacheprovider"], {
      cwd: dir,
      env: { ...env, ARMATURE_EVAL_MODE: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.once("error", fail);
    child.once("close", (code) => ok({ code: code ?? 1, output }));
  });
}

const lastLine = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .at(-1)
    ?.replace(/^=+\s*|\s*=+$/g, "") ?? "";

async function golden(dir: string): Promise<Omit<PartResult, "duration_ms">> {
  const { stale, edited } = scaffoldDrift(dir);
  const details = [
    ...stale.map((a) => `${a.action}: ${a.path} (run \`armature generate\`)`),
    ...edited.map((a) => `edited: ${a.path} (managed; move the change to armature.yaml or a file you own)`),
  ];
  return {
    part: "golden",
    passed: details.length === 0,
    summary: details.length
      ? `${details.length} file(s) differ from what armature.yaml renders`
      : "scaffold matches armature.yaml",
    details,
  };
}

async function unit(dir: string, env: NodeJS.ProcessEnv): Promise<Omit<PartResult, "duration_ms">> {
  const python = requireVenv(dir);
  const { code, output } = await pytest(python, dir, env);
  if (/No module named pytest/.test(output))
    throw new ArmatureError(
      "pytest is not installed in .venv",
      ExitCode.environment,
      "run `uv sync --extra dev`",
    );
  const lines = output.trim().split(/\r?\n/);
  return {
    part: "unit",
    passed: code === 0,
    summary: lastLine(output) || `pytest exited with ${code}`,
    details: code === 0 ? [] : lines.slice(-40),
  };
}

/**
 * Runs the project's tests: golden (managed files match what armature.yaml renders), unit
 * (the generated pytest suite, offline) and ARC conformance against the mock model.
 * Exits 1 when a part fails and 5 when the environment is missing.
 */
export async function testCommand(io: Io, dirArg: string | undefined, opts: TestOptions): Promise<number> {
  const dir = resolve(io.cwd, dirArg ?? ".");
  const unknown = (opts.only ?? []).filter((p) => !(TEST_PARTS as readonly string[]).includes(p));
  if (unknown.length)
    throw new ArmatureError(
      `unknown test part ${unknown.map((p) => `"${p}"`).join(", ")}`,
      ExitCode.validation,
      `parts: ${TEST_PARTS.join(", ")}`,
    );
  const parts = opts.only?.length ? TEST_PARTS.filter((p) => opts.only!.includes(p)) : [...TEST_PARTS];
  const plan = projectPlan(dir);
  const results: PartResult[] = [];
  let conformance: ConformanceReport | null = null;
  let envFailure: ExitCode | null = null;

  for (const part of parts) {
    if (!opts.json) io.stdout(`${c.bold(part)}\n`);
    const started = Date.now();
    let result: Omit<PartResult, "duration_ms">;
    try {
      if (part === "golden") result = await golden(dir);
      else if (part === "unit") result = await unit(dir, io.env);
      else {
        conformance = await projectConformance({
          dir,
          package: plan.package,
          env: io.env,
          ...(opts.json ? {} : { onCheck: (r) => renderConformance(io, r) }),
        });
        const failed = conformance.checks.filter((ch) => ch.status === "FAIL");
        result = {
          part,
          passed: conformance.passed,
          summary: failed.length
            ? `${failed.length} of ${conformance.checks.length} ARC checks failed`
            : `ARC v1: ${conformance.checks.length} checks passed`,
          details: failed.map((f) => `${f.key}: ${f.details.join(" | ")}`),
        };
      }
    } catch (err) {
      const f = toFailure(err);
      if (f.exit_code === ExitCode.environment) envFailure ??= f.exit_code;
      result = { part, passed: false, summary: f.message, details: f.hint ? [f.hint] : [] };
    }
    const full = { ...result, duration_ms: Date.now() - started };
    results.push(full);
    if (!opts.json) {
      if (part !== "conformance") for (const d of full.details) io.stdout(`  ${c.dim(d)}\n`);
      const mark = full.passed ? c.green("PASS") : c.red("FAIL");
      io.stdout(`  ${mark} ${full.summary} ${c.dim(`${(full.duration_ms / 1000).toFixed(1)}s`)}\n\n`);
    }
  }

  const passed = results.every((r) => r.passed);
  if (opts.json)
    printJson(io, {
      ok: passed,
      command: "test",
      dir,
      parts: results,
      ...(conformance ? { conformance } : {}),
    });
  else io.stdout(passed ? `${c.green("all tests passed")}\n` : `${c.red("tests failed")}\n`);
  if (passed) return ExitCode.ok;
  return envFailure ?? ExitCode.validation;
}
