import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TEMPLATE_VERSION, templateLayers } from "@armature/adapters";
import { handoffLayer, isHandoffPath, withSkillCopies } from "@armature/handoff";
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
  return parseSpecText(text, path);
}

export function parseSpecText(text: string, path = SPEC_FILE): LoadedSpec {
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
  const rendered = renderProject(plan, [...templateLayers(plan.framework), handoffLayer()]);
  const files = withSkillCopies(rendered, { targets: plan.assistant.targets });
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
  /** Spec source to use instead of reading specPath, e.g. for `init --dry-run`. */
  specText?: string;
  force?: boolean;
  dryRun?: boolean;
  allowExperimental?: boolean;
  /** Only refresh the coding-agent handoff files (`armature sync`); needs an existing lock. */
  handoffOnly?: boolean;
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
  const specPath = opts.specPath ?? join(dir, SPEC_FILE);
  const { spec, text } =
    opts.specText === undefined ? loadSpec(specPath) : parseSpecText(opts.specText, specPath);
  const compiled = compile(spec, { allowExperimental: opts.allowExperimental });
  const previous = readLock(dir);
  if (!previous) {
    if (opts.handoffOnly)
      throw new ArmatureError(
        `${dir} has no ${LOCK_FILE}`,
        ExitCode.validation,
        "run `armature generate` first; sync only refreshes an existing project",
      );
    assertInitTarget(dir, Boolean(opts.force));
  }
  const dryRun = Boolean(opts.dryRun);
  // Skill copies for Claude Code follow the canonical skills as they are on disk.
  let files = withSkillCopies(
    compiled.files.filter((f) => !f.path.startsWith(".claude/skills/")),
    { targets: compiled.plan.assistant.targets, dir, previous, force: opts.force },
  );
  let tracked = previous;
  if (opts.handoffOnly && previous) {
    files = files.filter((f) => isHandoffPath(f.path));
    tracked = {
      ...previous,
      files: Object.fromEntries(Object.entries(previous.files).filter(([p]) => isHandoffPath(p))),
    };
  }
  const { actions, entries } = applyFiles({ dir, files, previous: tracked, force: opts.force, dryRun });
  const kept =
    opts.handoffOnly && previous
      ? Object.fromEntries(Object.entries(previous.files).filter(([p]) => !isHandoffPath(p)))
      : {};
  const built = buildLock({
    framework: compiled.plan.framework,
    templateVersion: TEMPLATE_VERSION,
    specText: text,
    dependencies: compiled.plan.dependencies,
    files: { ...kept, ...entries },
  });
  // A sync leaves the rest of the project as it was, so the lock keeps describing the spec,
  // templates and dependencies that project was generated from.
  const lock =
    opts.handoffOnly && previous
      ? {
          ...built,
          spec_sha256: previous.spec_sha256,
          template_version: previous.template_version,
          dependencies: previous.dependencies,
        }
      : built;
  if (!dryRun) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LOCK_FILE), serializeLock(lock));
  }
  return { ...compiled, files, dir, mode: previous ? "update" : "init", actions, lock, dryRun };
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
