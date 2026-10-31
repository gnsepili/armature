import { resolve } from "node:path";
import { ExitCode, generate } from "@armature/core";
import { type Io, printJson } from "../io.ts";
import { generateJson, printActions } from "../report.ts";

export interface SyncCommandOptions {
  spec?: string;
  force?: boolean;
  dryRun?: boolean;
  experimental?: boolean;
  json?: boolean;
  verbose?: boolean;
}

/**
 * Refreshes only the coding-agent handoff: AGENTS.md, CLAUDE.md, docs/, skills (and their
 * .claude/skills copies) and the docs MCP config. Runtime code is left exactly as it is.
 */
export function syncCommand(io: Io, dirArg: string | undefined, opts: SyncCommandOptions): number {
  const dir = resolve(io.cwd, dirArg ?? ".");
  const result = generate({
    dir,
    specPath: opts.spec ? resolve(io.cwd, opts.spec) : undefined,
    force: opts.force,
    dryRun: opts.dryRun,
    allowExperimental: Boolean(opts.experimental),
    handoffOnly: true,
  });
  if (opts.json) {
    printJson(io, generateJson("sync", result));
    return ExitCode.ok;
  }
  printActions(io, result.actions, result.dryRun, opts.verbose);
  return ExitCode.ok;
}
