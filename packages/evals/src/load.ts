import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { ArmatureError, ExitCode } from "@armature/core";
import {
  type EvalCase,
  type EvalSpec,
  parseEvalCase,
  parseEvalSpec,
  parseReference,
  parseYamlText,
  type ReferenceTrajectory,
  SchemaError,
} from "@armature/schema";

/** Reads evals/evalspec.yaml, every suite's cases and their reference trajectories. */

export const EVALSPEC_PATH = "evals/evalspec.yaml";
export const FIXTURES_DIR = "evals/fixtures";

export interface Issue {
  level: "error" | "warning";
  message: string;
  case?: string;
  path?: string;
}

export interface LoadedCase {
  case: EvalCase;
  /** Path relative to the project (or absolute for suites outside it). */
  path: string;
  /** Hash of the parsed case and its reference; formatting and comments do not count. */
  sha256: string;
  reference: ReferenceTrajectory | null;
}

export interface LoadedSuite {
  name: string;
  config: EvalSpec["suites"][string];
  dir: string;
  /** False for held-out style suites outside the project directory. */
  inProject: boolean;
  exists: boolean;
  cases: LoadedCase[];
}

export interface Benchmark {
  dir: string;
  projectId: string;
  spec: EvalSpec;
  specSha256: string;
  suites: Map<string, LoadedSuite>;
  issues: Issue[];
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** JSON with sorted keys, so hashes ignore key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
export const hashValue = (value: unknown) => sha256(canonical(value));

export function expandSuitePath(path: string, dir: string, projectId: string): string {
  const p = path.replaceAll("<project-id>", projectId);
  if (p === "~" || p.startsWith("~/")) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(dir, p);
}

function yamlFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => /\.ya?ml$/.test(n) && !n.endsWith(".ref.yaml"))
      .filter((n) => statSync(join(dir, n)).isFile())
      .sort();
  } catch {
    return [];
  }
}

function describeError(err: unknown): string {
  if (err instanceof SchemaError)
    return err.issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ");
  return (err as Error).message;
}

export function projectIdOf(dir: string): string {
  try {
    const value = parseYamlText(readFileSync(join(dir, "armature.yaml"), "utf8"), "armature.yaml") as {
      name?: unknown;
    };
    if (typeof value?.name === "string" && value.name) return value.name;
  } catch {}
  return basename(resolve(dir));
}

export function loadEvalSpec(dir: string): { spec: EvalSpec; sha256: string } {
  const path = join(dir, EVALSPEC_PATH);
  if (!existsSync(path))
    throw new ArmatureError(
      `no ${EVALSPEC_PATH} in ${dir}`,
      ExitCode.validation,
      "run `armature generate` to seed the benchmark",
    );
  const text = readFileSync(path, "utf8");
  const spec = parseEvalSpec(parseYamlText(text, EVALSPEC_PATH), EVALSPEC_PATH);
  return { spec, sha256: hashValue(spec) };
}

export function loadBenchmark(dirInput: string, opts: { suites?: string[] } = {}): Benchmark {
  const dir = resolve(dirInput);
  const { spec, sha256: specSha256 } = loadEvalSpec(dir);
  const projectId = projectIdOf(dir);
  const issues: Issue[] = [];
  const suites = new Map<string, LoadedSuite>();
  const seen = new Map<string, string>();

  for (const [name, config] of Object.entries(spec.suites)) {
    if (opts.suites && !opts.suites.includes(name)) continue;
    const suiteDir = expandSuitePath(config.path, dir, projectId);
    const rel = relative(dir, suiteDir);
    const inProject = !rel.startsWith("..") && !isAbsolute(rel);
    const suite: LoadedSuite = {
      name,
      config,
      dir: suiteDir,
      inProject,
      exists: existsSync(suiteDir),
      cases: [],
    };
    suites.set(name, suite);
    for (const file of yamlFiles(suiteDir)) {
      const full = join(suiteDir, file);
      const path = inProject ? relative(dir, full).split("\\").join("/") : full;
      let parsed: EvalCase;
      try {
        parsed = parseEvalCase(parseYamlText(readFileSync(full, "utf8"), path), path);
      } catch (err) {
        issues.push({ level: "error", path, message: describeError(err) });
        continue;
      }
      const stem = file.replace(/\.ya?ml$/, "");
      if (parsed.id !== stem)
        issues.push({
          level: "error",
          case: parsed.id,
          path,
          message: `id "${parsed.id}" must match the file name "${stem}"`,
        });
      if (parsed.suite !== name && !(name === "heldout" && parsed.suite === "heldout"))
        issues.push({
          level: "warning",
          case: parsed.id,
          path,
          message: `case says suite "${parsed.suite}" but lives in suite "${name}"`,
        });
      const dup = seen.get(parsed.id);
      if (dup)
        issues.push({ level: "error", case: parsed.id, path, message: `duplicate case id (also in ${dup})` });
      seen.set(parsed.id, path);

      let reference: ReferenceTrajectory | null = null;
      if (parsed.reference) {
        // References resolve against evals/ for in-project suites, the suite dir otherwise.
        const base = inProject ? join(dir, "evals") : suiteDir;
        const refPath = isAbsolute(parsed.reference) ? parsed.reference : join(base, parsed.reference);
        try {
          reference = parseReference(
            parseYamlText(readFileSync(refPath, "utf8"), parsed.reference),
            parsed.reference,
          );
          if (reference.case !== parsed.id)
            issues.push({
              level: "error",
              case: parsed.id,
              path: parsed.reference,
              message: `reference is for case "${reference.case}", not "${parsed.id}"`,
            });
        } catch (err) {
          issues.push({
            level: "error",
            case: parsed.id,
            path: parsed.reference,
            message: existsSync(refPath) ? describeError(err) : "reference file not found",
          });
          reference = null;
        }
      }
      suite.cases.push({ case: parsed, path, reference, sha256: hashValue({ case: parsed, reference }) });
    }
  }
  return { dir, projectId, spec, specSha256, suites, issues };
}

export function suiteOrThrow(bench: Benchmark, name: string): LoadedSuite {
  const suite = bench.suites.get(name);
  if (!suite)
    throw new ArmatureError(
      `no suite "${name}" in ${EVALSPEC_PATH}`,
      ExitCode.validation,
      `suites: ${[...bench.suites.keys()].join(", ") || "none"}`,
    );
  return suite;
}

export const firstUserText = (c: EvalCase): string =>
  typeof c.input === "string"
    ? c.input.trim()
    : (c.input.find((m) => m.role === "user")?.content ?? "").trim();
