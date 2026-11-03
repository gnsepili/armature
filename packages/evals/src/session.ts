import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ArcClient, type Manifest } from "@armature/arc";
import {
  ArmatureError,
  compile,
  ExitCode,
  launchApp,
  loadSpec,
  type ProjectPlan,
  type RunningApp,
  SPEC_FILE,
} from "@armature/core";
import { type MockLlm, startMockLlm } from "@armature/mock-llm";

/**
 * An eval session: the generated app running in eval mode (stubs on, write and destructive
 * tools stubbed), against the mock model offline or the configured provider live.
 */

export interface EvalSession {
  plan: ProjectPlan;
  client: ArcClient;
  manifest: Manifest;
  mock: MockLlm | null;
  app: RunningApp;
  mode: "MOCK" | "LIVE";
  stop: () => Promise<void>;
}

export function loadPlan(dir: string): ProjectPlan {
  const { spec } = loadSpec(join(dir, SPEC_FILE));
  return compile(spec, { allowExperimental: true }).plan;
}

/** True when the key is in the environment or in the project's .env file. */
export function hasApiKey(dir: string, env: NodeJS.ProcessEnv, name: string): boolean {
  if (env[name]) return true;
  const dotenv = join(dir, ".env");
  if (!existsSync(dotenv)) return false;
  return readFileSync(dotenv, "utf8")
    .split(/\r?\n/)
    .some((line) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=\\s*\\S`).test(line));
}

export async function startEvalSession(opts: {
  dir: string;
  offline: boolean;
  env: NodeJS.ProcessEnv;
  caseTimeoutS?: number;
}): Promise<EvalSession> {
  const plan = loadPlan(opts.dir);
  const env: NodeJS.ProcessEnv = { ...opts.env, ARMATURE_EVAL_MODE: "1" };
  let mock: MockLlm | null = null;
  if (opts.offline) {
    mock = await startMockLlm({ port: 0, host: "127.0.0.1", mode: "smoke" });
    env.ARMATURE_MODEL_MODE = "mock";
    env.ARMATURE_MOCK_URL = mock.baseUrl;
  } else {
    env.ARMATURE_MODEL_MODE = "live";
    if (!hasApiKey(opts.dir, env, plan.model.api_key_env))
      throw new ArmatureError(
        `${plan.model.api_key_env} is not set`,
        ExitCode.environment,
        "set it in the environment or .env, or pass --offline to run against the mock model",
      );
  }
  let app: RunningApp;
  try {
    app = await launchApp({ dir: opts.dir, package: plan.package, env });
  } catch (err) {
    await mock?.close();
    throw err;
  }
  const client = new ArcClient(app.url, ((opts.caseTimeoutS ?? 180) + 15) * 1000);
  const stop = async () => {
    await app.stop();
    await mock?.close();
  };
  try {
    const health = await client.health();
    if (!health.eval_mode)
      throw new ArmatureError("the app did not start in eval mode", ExitCode.environment);
    const manifest = await client.manifest();
    return { plan, client, manifest, mock, app, mode: opts.offline ? "MOCK" : "LIVE", stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
