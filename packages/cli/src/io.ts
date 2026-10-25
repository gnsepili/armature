import { ArmatureError, ExitCode } from "@armature/core";
import { SchemaError } from "@armature/schema";

/** Where a command reads and writes. Tests pass their own; the binary uses the process. */
export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Reads all of stdin (for `--config -`). */
  readStdin: () => Promise<string>;
  /** True when a person can answer prompts. */
  interactive: boolean;
}

export function processIo(): Io {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI,
  };
}

const useColor = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  cyan: paint(36),
};

export interface Failure {
  message: string;
  exit_code: ExitCode;
  hint?: string;
  issues?: { path: string; message: string }[];
}

/** Maps any thrown value to a user-facing failure with a stable exit code. */
export function toFailure(err: unknown): Failure {
  if (err instanceof ArmatureError) return { message: err.message, exit_code: err.exitCode, hint: err.hint };
  if (err instanceof SchemaError)
    return { message: err.message, exit_code: ExitCode.validation, issues: err.issues };
  const message = err instanceof Error ? err.message : String(err);
  return { message, exit_code: ExitCode.environment };
}

export function printFailure(io: Io, f: Failure, json: boolean) {
  if (json) {
    io.stdout(`${JSON.stringify({ ok: false, error: f }, null, 2)}\n`);
    return;
  }
  io.stderr(`${c.red("error")} ${f.message}\n`);
  for (const issue of f.issues ?? []) io.stderr(`  ${c.yellow(issue.path || "(root)")} ${issue.message}\n`);
  if (f.hint) io.stderr(`${c.dim("hint")}  ${f.hint}\n`);
}

export const printJson = (io: Io, value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
