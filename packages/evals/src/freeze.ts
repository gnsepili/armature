import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArmatureError, ExitCode } from "@armature/core";
import { z } from "zod";
import { GRADERS_VERSION } from "./grade.ts";
import { type Benchmark, hashValue } from "./load.ts";

/**
 * evals/benchmark.lock records a hash of every in-repo case, the eval spec and an aggregate
 * hash of out-of-repo (held-out) suites. Runs compare against it and flag any change.
 */

export const BENCHMARK_LOCK = "evals/benchmark.lock";

const Lock = z
  .object({
    schema_version: z.literal(1),
    evalspec_sha256: z.string(),
    graders_version: z.string(),
    suites: z.record(z.string(), z.object({ cases: z.record(z.string(), z.string()) })),
    private_suites: z.record(z.string(), z.object({ count: z.number().int(), sha256: z.string() })),
  })
  .strict();
export type BenchmarkLock = z.infer<typeof Lock>;

export function readBenchmarkLock(dir: string): BenchmarkLock | null {
  const path = join(dir, BENCHMARK_LOCK);
  if (!existsSync(path)) return null;
  try {
    return Lock.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    throw new ArmatureError(
      `${BENCHMARK_LOCK} is invalid: ${(err as Error).message}`,
      ExitCode.validation,
      "run `armature eval freeze` again",
    );
  }
}

export function buildBenchmarkLock(bench: Benchmark): BenchmarkLock {
  const suites: BenchmarkLock["suites"] = {};
  const privateSuites: BenchmarkLock["private_suites"] = {};
  for (const s of bench.suites.values()) {
    if (s.name === "candidates") continue;
    const cases = Object.fromEntries(
      s.cases.map((c) => [c.case.id, c.sha256]).sort(([a], [b]) => (a! < b! ? -1 : 1)),
    );
    if (s.inProject) suites[s.name] = { cases };
    else privateSuites[s.name] = { count: s.cases.length, sha256: hashValue(cases) };
  }
  return {
    schema_version: 1,
    evalspec_sha256: bench.specSha256,
    graders_version: GRADERS_VERSION,
    suites,
    private_suites: privateSuites,
  };
}

/** Freezes the benchmark. Requires every dev case and at least one held-out case VERIFIED. */
export function freezeBenchmark(bench: Benchmark): BenchmarkLock {
  const problems: string[] = [];
  const errors = bench.issues.filter((i) => i.level === "error");
  if (errors.length) problems.push(`${errors.length} validation error(s); run \`armature eval validate\``);
  const dev = bench.suites.get("dev");
  if (!dev || dev.cases.length === 0) problems.push("the dev suite has no cases");
  else {
    const drafts = dev.cases.filter((c) => c.case.trust !== "VERIFIED").map((c) => c.case.id);
    if (drafts.length)
      problems.push(
        `${drafts.length} dev case(s) are not VERIFIED: ${drafts.slice(0, 8).join(", ")}${drafts.length > 8 ? ", ..." : ""}`,
      );
  }
  const heldout = bench.suites.get("heldout");
  if (heldout && !heldout.cases.some((c) => c.case.trust === "VERIFIED"))
    problems.push(`the held-out suite (${heldout.dir}) has no VERIFIED case`);
  if (problems.length)
    throw new ArmatureError(
      `cannot freeze the benchmark:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
      ExitCode.validation,
      "a human reviews each case and sets `trust: VERIFIED`",
    );
  const lock = buildBenchmarkLock(bench);
  writeFileSync(join(bench.dir, BENCHMARK_LOCK), `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

export interface FrozenDiff {
  changed: boolean;
  evalspec: boolean;
  graders: boolean;
  added: string[];
  removed: string[];
  modified: string[];
  private_suites: string[];
}

/** Null when there is no benchmark.lock. Only suites in `bench` are compared. */
export function checkFrozen(bench: Benchmark, lock = readBenchmarkLock(bench.dir)): FrozenDiff | null {
  if (!lock) return null;
  const now = buildBenchmarkLock(bench);
  const diff: FrozenDiff = {
    changed: false,
    evalspec: now.evalspec_sha256 !== lock.evalspec_sha256,
    graders: now.graders_version !== lock.graders_version,
    added: [],
    removed: [],
    modified: [],
    private_suites: [],
  };
  for (const [name, suite] of Object.entries(now.suites)) {
    const before = lock.suites[name]?.cases ?? {};
    for (const [id, sha] of Object.entries(suite.cases)) {
      if (!(id in before)) diff.added.push(id);
      else if (before[id] !== sha) diff.modified.push(id);
    }
    for (const id of Object.keys(before)) if (!(id in suite.cases)) diff.removed.push(id);
  }
  for (const [name, s] of Object.entries(now.private_suites)) {
    const before = lock.private_suites[name];
    if (before && before.sha256 !== s.sha256) diff.private_suites.push(name);
  }
  diff.changed =
    diff.evalspec ||
    diff.graders ||
    diff.added.length + diff.removed.length + diff.modified.length + diff.private_suites.length > 0;
  return diff;
}
