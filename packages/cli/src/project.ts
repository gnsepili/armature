import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CheckResult, type ConformanceReport, runConformance } from "@armature/arc";
import {
  applyFiles,
  compile,
  launchApp,
  loadSpec,
  type PlannedAction,
  type ProjectPlan,
  type RunningApp,
  readLock,
  SPEC_FILE,
} from "@armature/core";
import { startMockLlm } from "@armature/mock-llm";

/** Shared by `doctor` and `test`: scaffold drift and ARC conformance for a generated project. */

export function projectPlan(dir: string): ProjectPlan {
  const { spec } = loadSpec(join(dir, SPEC_FILE));
  return compile(spec, { allowExperimental: true }).plan;
}

export interface Drift {
  /** Files `armature generate` would create, update or remove: the scaffold is behind the spec. */
  stale: PlannedAction[];
  /** Managed files the user edited, which `generate` will no longer update. */
  edited: PlannedAction[];
}

/** Compares the project with what the current spec and templates render. Writes nothing. */
export function scaffoldDrift(dir: string): Drift {
  const { spec } = loadSpec(join(dir, SPEC_FILE));
  const { files } = compile(spec, { allowExperimental: true });
  const { actions } = applyFiles({ dir, files, previous: readLock(dir), dryRun: true });
  return {
    stale: actions.filter((a) => a.action === "create" || a.action === "update" || a.action === "remove"),
    edited: actions.filter((a) => a.action === "skip-modified" || a.action === "keep-orphan"),
  };
}

/**
 * Serves the project twice against a fresh mock model, in eval mode and out of it (check 7
 * needs both), and runs the ARC conformance suite. Session databases go to a temp directory
 * so nothing lands in the project.
 */
export async function projectConformance(opts: {
  dir: string;
  package: string;
  env: NodeJS.ProcessEnv;
  onCheck?: (r: CheckResult) => void;
}): Promise<ConformanceReport> {
  const scratch = mkdtempSync(join(tmpdir(), "armature-conformance-"));
  const mock = await startMockLlm({ port: 0, host: "127.0.0.1" });
  const apps: RunningApp[] = [];
  try {
    const env = (evalMode: boolean): NodeJS.ProcessEnv => ({
      ...opts.env,
      ARMATURE_MODEL_MODE: "mock",
      ARMATURE_MOCK_URL: mock.baseUrl,
      ARMATURE_EVAL_MODE: evalMode ? "1" : "0",
      ARMATURE_SESSION_DB: join(scratch, `sessions-${evalMode ? "eval" : "normal"}.db`),
    });
    apps.push(await launchApp({ dir: opts.dir, package: opts.package, env: env(true) }));
    apps.push(await launchApp({ dir: opts.dir, package: opts.package, env: env(false) }));
    return await runConformance({
      app: apps[0]!.url,
      normalApp: apps[1]!.url,
      mockUrl: mock.url,
      ...(opts.onCheck ? { onCheck: opts.onCheck } : {}),
    });
  } finally {
    await Promise.all(apps.map((a) => a.stop()));
    await mock.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
