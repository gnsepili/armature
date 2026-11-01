import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { ArmatureError, ExitCode } from "./errors.ts";

/** Launching a generated project's ARC server, shared by `dev`, `eval` and `test`. */

export function venvPython(dir: string): string {
  return process.platform === "win32"
    ? join(dir, ".venv", "Scripts", "python.exe")
    : join(dir, ".venv", "bin", "python");
}

export function requireVenv(dir: string): string {
  const python = venvPython(dir);
  if (!existsSync(python))
    throw new ArmatureError(
      `no virtual environment in ${dir}`,
      ExitCode.environment,
      "run `uv sync` in the project first",
    );
  return python;
}

/** Asks the OS for a free TCP port. */
export function freePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, host, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => ok(port));
    });
  });
}

export async function waitHealthy(url: string, child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new ArmatureError(
        `the app exited with code ${child.exitCode} before it was ready`,
        ExitCode.environment,
      );
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new ArmatureError(
    `the app did not answer ${url}/health within ${timeoutMs / 1000}s`,
    ExitCode.environment,
  );
}

export interface RunningApp {
  url: string;
  child: ChildProcess;
  /** Output captured when stdio is "pipe"; useful in error messages. */
  logs: () => string;
  stop: () => Promise<void>;
}

/** Starts `python -m <package> serve` in the project's venv and waits for /health. */
export async function launchApp(opts: {
  dir: string;
  package: string;
  env: NodeJS.ProcessEnv;
  host?: string;
  port?: number;
  stdio?: "inherit" | "pipe";
}): Promise<RunningApp> {
  const python = requireVenv(opts.dir);
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? (await freePort(host));
  const stdio = opts.stdio ?? "pipe";
  const child = spawn(python, ["-m", opts.package, "serve", "--host", host, "--port", String(port)], {
    cwd: opts.dir,
    env: opts.env,
    stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const keep = (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(-20_000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const url = `http://${host}:${port}`;
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((ok) => child.once("exit", () => ok()));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(timer);
  };
  try {
    await waitHealthy(url, child);
  } catch (err) {
    await stop();
    if (err instanceof ArmatureError && output)
      throw new ArmatureError(
        `${err.message}\n${output.trim().split("\n").slice(-15).join("\n")}`,
        err.exitCode,
      );
    throw err;
  }
  return { url, child, logs: () => output, stop };
}
