import { resolve } from "node:path";
import { ExitCode, generate } from "@armature/core";
import { type Io, printJson } from "../io.ts";
import { generateJson, printActions, printCompat } from "../report.ts";

export interface GenerateCommandOptions {
  spec?: string;
  force?: boolean;
  dryRun?: boolean;
  experimental?: boolean;
  json?: boolean;
  verbose?: boolean;
}

export function generateCommand(io: Io, dirArg: string | undefined, opts: GenerateCommandOptions): number {
  const dir = resolve(io.cwd, dirArg ?? ".");
  const result = generate({
    dir,
    specPath: opts.spec ? resolve(io.cwd, opts.spec) : undefined,
    force: opts.force,
    dryRun: opts.dryRun,
    allowExperimental: Boolean(opts.experimental),
  });
  if (opts.json) {
    printJson(io, generateJson("generate", result));
    return ExitCode.ok;
  }
  printCompat(io, result.compat);
  printActions(io, result.actions, result.dryRun, opts.verbose);
  return ExitCode.ok;
}
