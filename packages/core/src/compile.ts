import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TEMPLATE_VERSION, templateLayers } from "@armature/adapters";
import { type AgentSpec, parseAgentSpec, parseYamlText } from "@armature/schema";
import { type CompatReport, checkCompatibility } from "./compat.ts";
import { ArmatureError, ExitCode } from "./errors.ts";
import { buildLock, LOCK_FILE, type LockFile, lockEntries, parseLock, serializeLock } from "./lock.ts";
import { type ProjectPlan, planProject } from "./plan.ts";
import { type RenderedFile, renderProject } from "./render.ts";
import { applyFiles, assertInitTarget, type PlannedAction } from "./write.ts";

export const SPEC_FILE = "armature.yaml";

export interface LoadedSpec {
  spec: AgentSpec;
  text: string;
  path: string;
}

export function loadSpec(path: string): LoadedSpec {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ArmatureError(
      `cannot read ${path}`,
      ExitCode.validation,
      "run `armature init` to create one, or pass --spec <path>",
    );
  }
  return { spec: parseAgentSpec(parseYamlText(text, path), path), text, path };
}

export interface Compiled {
  plan: ProjectPlan;
  compat: CompatReport;
  files: RenderedFile[];
}

/** Pure: spec in, files out. No filesystem writes. */
export function compile(spec: AgentSpec, opts: { allowExperimental?: boolean } = {}): Compiled {
  const compat = checkCompatibility(spec);
  if (compat.status === "unsupported") {
    const errors = compat.findings.filter((f) => f.level === "error");
    throw new ArmatureError(
      `this spec cannot be generated:\n${errors.map((f) => `  - ${f.path}: ${f.message}`).join("\n")}`,
      ExitCode.unsupported,
    );
  }
  if (compat.status === "experimental" && opts.allowExperimental === false)
    throw new ArmatureError(
      "this spec uses an experimental model or endpoint",
      ExitCode.unsupported,
      "pass --experimental to generate anyway",
    );
  const plan = planProject(spec);
  const files = renderProject(plan, templateLayers(plan.framework));
  return { plan, compat, files };
}

export function readLock(dir: string): LockFile | null {
  let text: string;
  try {
    text = readFileSync(join(dir, LOCK_FILE), "utf8");
  } catch {
    return null;
  }
  return parseLock(text);
}

export interface GenerateOptions {
  dir: string;
  /** Defaults to <dir>/armature.yaml. */
  specPath?: string;
  force?: boolean;
  dryRun?: boolean;
  allowExperimental?: boolean;
}

export interface GenerateResult extends Compiled {
  dir: string;
  mode: "init" | "update";
  actions: PlannedAction[];
  lock: LockFile;
  dryRun: boolean;
}

/**
 * Generates or updates a project. The first run (no armature.lock) refuses a non-empty
 * directory unless forced; later runs only touch files the user has not edited.
 */
export function generate(opts: GenerateOptions): GenerateResult {
  const dir = resolve(opts.dir);
  const { spec, text } = loadSpec(opts.specPath ?? join(dir, SPEC_FILE));
  const compiled = compile(spec, { allowExperimental: opts.allowExperimental });
  const previous = readLock(dir);
  if (!previous) assertInitTarget(dir, Boolean(opts.force));
  const dryRun = Boolean(opts.dryRun);
  const { actions, entries } = applyFiles({
    dir,
    files: compiled.files,
    previous,
    force: opts.force,
    dryRun,
  });
  const lock = buildLock({
    framework: compiled.plan.framework,
    templateVersion: TEMPLATE_VERSION,
    specText: text,
    dependencies: compiled.plan.dependencies,
    files: entries,
  });
  if (!dryRun) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LOCK_FILE), serializeLock(lock));
  }
  return { ...compiled, dir, mode: previous ? "update" : "init", actions, lock, dryRun };
}

/** In-memory render with a lock, for golden tests and `armature plan`. */
export function renderWithLock(spec: AgentSpec, specText: string) {
  const compiled = compile(spec);
  const lock = buildLock({
    framework: compiled.plan.framework,
    templateVersion: TEMPLATE_VERSION,
    specText,
    dependencies: compiled.plan.dependencies,
    files: lockEntries(compiled.files),
  });
  return { ...compiled, lock };
}
