/**
 * Shared steps for end-to-end tests: generate a project, install it with uv, run its
 * pytest suite and serve it for ARC conformance. Everything runs offline against the
 * mock LLM once uv has the pinned wheels cached.
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { type ConformanceReport, runConformance } from "../packages/arc/src/index.ts";
import { generate } from "../packages/core/src/index.ts";
import { type MockLlm, startMockLlm } from "../packages/mock-llm/src/index.ts";

export const OUT = resolve(import.meta.dirname, ".out");

export function hasUv(): boolean {
  return spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0;
}

export function generateProject(name: string, spec: Record<string, unknown>): string {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // JSON is valid YAML, which keeps this harness free of a YAML dependency.
  writeFileSync(join(dir, "armature.yaml"), `${JSON.stringify(spec, null, 2)}\n`);
  generate({ dir, force: true });
  return dir;
}

export function install(dir: string): void {
  const opts = { cwd: dir, stdio: "pipe" as const, timeout: 300_000 };
  execFileSync("uv", ["venv", "--quiet", "--python", "3.12"], opts);
  execFileSync("uv", ["pip", "install", "--quiet", "-e", ".[dev]"], opts);
}

export function pytest(dir: string): { ok: boolean; output: string } {
  const run = spawnSync(join(dir, ".venv/bin/python"), ["-m", "pytest", "-q", "-p", "no:cacheprovider"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 300_000,
  });
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => ok(port));
    });
  });
}

async function waitHealthy(url: string, child: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${logs()}`);
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server at ${url} never became healthy:\n${logs()}`);
}

async function serve(dir: string, pkg: string, mock: MockLlm, evalMode: boolean) {
  const port = await freePort();
  let logs = "";
  const child = spawn(join(dir, ".venv/bin/python"), ["-m", pkg, "serve", "--port", String(port)], {
    cwd: dir,
    env: {
      ...process.env,
      ARMATURE_MODEL_MODE: "mock",
      ARMATURE_MOCK_URL: mock.baseUrl,
      ARMATURE_EVAL_MODE: evalMode ? "1" : "0",
      ARMATURE_SESSION_DB: join(dir, `.armature/sessions-${port}.db`),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => (logs += d));
  child.stderr?.on("data", (d) => (logs += d));
  const url = `http://127.0.0.1:${port}`;
  await waitHealthy(url, child, () => logs);
  return { url, child, logs: () => logs };
}

/** Serves the project twice (eval mode on and off) against a fresh mock LLM and runs conformance. */
export async function conformance(
  dir: string,
  pkg: string,
): Promise<{ report: ConformanceReport; logs: string }> {
  const mock = await startMockLlm({ port: 0 });
  const servers: Awaited<ReturnType<typeof serve>>[] = [];
  try {
    servers.push(await serve(dir, pkg, mock, true), await serve(dir, pkg, mock, false));
    const [app, normal] = servers;
    const report = await runConformance({ app: app!.url, normalApp: normal!.url, mockUrl: mock.url });
    return { report, logs: servers.map((s) => s.logs()).join("\n") };
  } finally {
    for (const s of servers) s.child.kill();
    await mock.close();
  }
}

export function summary(report: ConformanceReport): string {
  return report.checks.map((c) => `${c.status} ${c.key} ${c.details.join(" | ")}`).join("\n");
}
