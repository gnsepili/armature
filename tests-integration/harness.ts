/**
 * Shared steps for end-to-end tests: generate a project, install it with uv, run its
 * pytest suite and serve it for ARC conformance. Everything runs offline against the
 * mock LLM once uv has the pinned wheels cached.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type ConformanceReport, runConformance } from "../packages/arc/src/index.ts";
import { generate, launchApp, type RunningApp, venvPython } from "../packages/core/src/index.ts";
import { startMockLlm } from "../packages/mock-llm/src/index.ts";

/** Where projects are generated. CI points this at a path with spaces. */
export const OUT = resolve(process.env.ARMATURE_IT_OUT ?? resolve(import.meta.dirname, ".out"));
/** Python the generated projects target and install with. */
export const PYTHON = process.env.ARMATURE_IT_PYTHON ?? "3.12";

export function hasUv(): boolean {
  return spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;
}

export function generateProject(name: string, spec: Record<string, unknown>): string {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // JSON is valid YAML, which keeps this harness free of a YAML dependency.
  const runtime = { ...(spec.runtime as Record<string, unknown>), python_version: PYTHON };
  writeFileSync(join(dir, "armature.yaml"), `${JSON.stringify({ ...spec, runtime }, null, 2)}\n`);
  generate({ dir, force: true });
  return dir;
}

export function install(dir: string): void {
  const opts = { cwd: dir, stdio: "pipe" as const, timeout: 300_000 };
  execFileSync("uv", ["venv", "--quiet", "--python", PYTHON], opts);
  execFileSync("uv", ["pip", "install", "--quiet", "-e", ".[dev]"], opts);
}

export function pytest(dir: string): { ok: boolean; output: string } {
  const run = spawnSync(venvPython(dir), ["-m", "pytest", "-q", "-p", "no:cacheprovider"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 300_000,
  });
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
}

/** Serves the project twice (eval mode on and off) against a fresh mock LLM and runs conformance. */
export async function conformance(
  dir: string,
  pkg: string,
): Promise<{ report: ConformanceReport; logs: string }> {
  const mock = await startMockLlm({ port: 0 });
  const apps: RunningApp[] = [];
  const env = (evalMode: boolean) => ({
    ...process.env,
    ARMATURE_MODEL_MODE: "mock",
    ARMATURE_MOCK_URL: mock.baseUrl,
    ARMATURE_EVAL_MODE: evalMode ? "1" : "0",
    ARMATURE_SESSION_DB: join(dir, `.armature/sessions-${evalMode ? "eval" : "normal"}.db`),
  });
  try {
    apps.push(await launchApp({ dir, package: pkg, env: env(true) }));
    apps.push(await launchApp({ dir, package: pkg, env: env(false) }));
    const report = await runConformance({ app: apps[0]!.url, normalApp: apps[1]!.url, mockUrl: mock.url });
    return { report, logs: apps.map((a) => a.logs()).join("\n") };
  } finally {
    await Promise.all(apps.map((a) => a.stop()));
    await mock.close();
  }
}

export function summary(report: ConformanceReport): string {
  return report.checks.map((c) => `${c.status} ${c.key} ${c.details.join(" | ")}`).join("\n");
}

/** Runs `armature eval <args>` in-process against the project; returns the exit code and output. */
export function evalCli(dir: string, args: string[]): Promise<{ code: number; out: string }> {
  return armature(dir, ["eval", ...args]);
}

/** Runs `armature <args>` in-process against a generated project. */
export async function armature(dir: string, args: string[]): Promise<{ code: number; out: string }> {
  const { run } = await import("../packages/cli/src/index.ts");
  const out: string[] = [];
  const code = await run(args, {
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: (t) => {
      out.push(t);
    },
    stderr: (t) => {
      out.push(t);
    },
    readStdin: async () => "",
    interactive: false,
  });
  return { code, out: out.join("") };
}
