import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/index.ts";
import type { Io } from "../src/io.ts";

export interface Captured {
  code: number;
  out: string;
  err: string;
  json: () => any;
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "armature-cli-"));
}

export function testIo(cwd: string, stdin = ""): Io & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    env: { NO_COLOR: "1" },
    stdout: (t) => {
      out.push(t);
    },
    stderr: (t) => {
      err.push(t);
    },
    readStdin: async () => stdin,
    interactive: false,
    out,
    err,
  };
}

/** Runs `armature <argv>` in-process with captured output. */
export async function cli(cwd: string, argv: string[], stdin?: string): Promise<Captured> {
  const io = testIo(cwd, stdin);
  const code = await run(argv, io);
  const out = io.out.join("");
  return { code, out, err: io.err.join(""), json: () => JSON.parse(out) };
}
