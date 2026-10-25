import type { CompatReport, FileAction, GenerateResult, PlannedAction } from "@armature/core";
import { c, type Io } from "./io.ts";

const VERB: Record<FileAction, string> = {
  create: "create",
  update: "update",
  unchanged: "unchanged",
  "skip-modified": "kept (edited)",
  "skip-owned": "kept (yours)",
  remove: "remove",
  "keep-orphan": "kept (orphan)",
};

export function countActions(actions: PlannedAction[]): Partial<Record<FileAction, number>> {
  const out: Partial<Record<FileAction, number>> = {};
  for (const a of actions) out[a.action] = (out[a.action] ?? 0) + 1;
  return out;
}

export function printActions(io: Io, actions: PlannedAction[], dryRun: boolean, verbose = false) {
  const changed = actions.filter((a) => a.action !== "unchanged");
  const shown = verbose ? actions : changed;
  for (const a of shown) {
    const tag = VERB[a.action].padEnd(14);
    const color =
      a.action === "create" || a.action === "update"
        ? c.green
        : a.action === "remove"
          ? c.red
          : a.action === "unchanged"
            ? c.dim
            : c.yellow;
    io.stdout(`  ${color(tag)} ${a.path}\n`);
  }
  const counts = countActions(actions);
  const summary = Object.entries(counts)
    .map(([k, n]) => `${n} ${VERB[k as FileAction]}`)
    .join(", ");
  io.stdout(`${dryRun ? c.yellow("dry run, nothing written: ") : ""}${summary || "no files"}\n`);
  if (counts["skip-modified"])
    io.stdout(c.dim("Edited managed files were left alone. Review them, or pass --force to overwrite.\n"));
}

export function printCompat(io: Io, compat: CompatReport) {
  for (const f of compat.findings) {
    if (f.level === "info") continue;
    const tag = f.level === "error" ? c.red("error") : c.yellow("warn ");
    io.stderr(`${tag} ${f.path}: ${f.message}\n`);
  }
}

export function generateJson(command: string, r: GenerateResult) {
  return {
    ok: true,
    command,
    dir: r.dir,
    mode: r.mode,
    dry_run: r.dryRun,
    name: r.plan.name,
    package: r.plan.package,
    framework: r.plan.framework,
    compat: r.compat,
    files: r.actions,
    counts: countActions(r.actions),
    dependencies: r.plan.dependencies,
  };
}
