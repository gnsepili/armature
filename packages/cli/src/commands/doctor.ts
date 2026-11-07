import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { TEMPLATE_VERSION } from "@armature/adapters";
import type { CheckResult, ConformanceReport } from "@armature/arc";
import {
  compile,
  ExitCode,
  LOCK_FILE,
  loadSpec,
  type ProjectPlan,
  readLock,
  SPEC_FILE,
  venvPython,
  versionsCatalog,
} from "@armature/core";
import { hasApiKey, startEvalSession } from "@armature/evals";
import { c, type Io, printJson, toFailure } from "../io.ts";
import { projectConformance, scaffoldDrift } from "../project.ts";

export interface DoctorOptions {
  probe?: boolean;
  conformance?: boolean;
  json?: boolean;
}

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  hint?: string;
  /** Exit code the check contributes when it fails. */
  exit_code?: ExitCode;
}

export interface ProbeResult {
  status: string;
  tool_called: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  latency_ms: number;
}

const INSTALL = "uv sync --extra dev";
const ok = (name: string, message: string): DoctorCheck => ({ name, status: "ok", message });
const warn = (name: string, message: string, hint?: string): DoctorCheck => ({
  name,
  status: "warn",
  message,
  ...(hint ? { hint } : {}),
});
const fail = (name: string, message: string, exit: ExitCode, hint?: string): DoctorCheck => ({
  name,
  status: "fail",
  message,
  exit_code: exit,
  ...(hint ? { hint } : {}),
});
const skip = (name: string, message: string): DoctorCheck => ({ name, status: "skip", message });

const major = (v: string) => Number(v.split(".")[0]);
const list = (paths: { path: string }[], n = 3) =>
  paths
    .slice(0, n)
    .map((p) => p.path)
    .join(", ") + (paths.length > n ? ` and ${paths.length - n} more` : "");

const PY_INSPECT = `import sys, json, importlib.metadata as m, importlib.util as u
pkg, names = sys.argv[1], sys.argv[2:]
def version(n):
    try:
        return m.version(n)
    except m.PackageNotFoundError:
        return None
print(json.dumps({"python": "%d.%d.%d" % sys.version_info[:3], "package": u.find_spec(pkg) is not None, "versions": {n: version(n) for n in names}}))`;

interface PyInfo {
  python: string;
  package: boolean;
  versions: Record<string, string | null>;
}

function inspectVenv(dir: string, plan: ProjectPlan, env: NodeJS.ProcessEnv): PyInfo | string {
  const names = [...plan.dependencies, ...plan.dev_dependencies].map((d) => d.name);
  const run = spawnSync(venvPython(dir), ["-c", PY_INSPECT, plan.package, ...names], {
    cwd: dir,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (run.status !== 0) return (run.stderr || run.error?.message || "python failed").trim();
  return JSON.parse(run.stdout) as PyInfo;
}

function pythonChecks(dir: string, plan: ProjectPlan, env: NodeJS.ProcessEnv): DoctorCheck[] {
  if (!existsSync(venvPython(dir)))
    return [fail("venv", `no virtual environment in ${dir}`, ExitCode.environment, `run \`${INSTALL}\``)];
  const info = inspectVenv(dir, plan, env);
  if (typeof info === "string")
    return [
      fail(
        "venv",
        `.venv python does not run: ${info}`,
        ExitCode.environment,
        `recreate it with \`${INSTALL}\``,
      ),
    ];
  const out: DoctorCheck[] = [];
  const minor = info.python.split(".").slice(0, 2).join(".");
  out.push(
    versionsCatalog.python.supported.includes(minor)
      ? ok("python", `Python ${info.python}`)
      : warn(
          "python",
          `Python ${info.python} is not one Armature verified (${versionsCatalog.python.supported.join(", ")})`,
          `recreate the venv with \`uv venv --python ${plan.python_version}\``,
        ),
  );
  const problems = (deps: ProjectPlan["dependencies"]) => [
    ...deps.filter((d) => !info.versions[d.name]).map((d) => `${d.name} is missing`),
    ...deps
      .filter((d) => info.versions[d.name] && info.versions[d.name] !== d.version)
      .map((d) => `${d.name} ${info.versions[d.name]} (pinned ${d.version})`),
  ];
  const runtime = [
    ...(info.package ? [] : [`${plan.package} is not installed`]),
    ...problems(plan.dependencies),
  ];
  out.push(
    runtime.length
      ? fail("dependencies", runtime.join("; "), ExitCode.environment, `run \`${INSTALL}\``)
      : ok("dependencies", `${plan.dependencies.length} pinned packages installed`),
  );
  // Dev pins only matter for `armature test`; a production image may leave them out.
  const dev = problems(plan.dev_dependencies);
  if (dev.length)
    out.push(warn("dev deps", `${dev.join("; ")}; needed by \`armature test\``, `run \`${INSTALL}\``));
  return out;
}

function lockChecks(dir: string): DoctorCheck[] {
  const lock = readLock(dir);
  if (!lock) return [fail("scaffold", `no ${LOCK_FILE}`, ExitCode.validation, "run `armature generate`")];
  const out: DoctorCheck[] = [];
  if (lock.template_version !== TEMPLATE_VERSION)
    out.push(
      warn(
        "templates",
        `generated with templates v${lock.template_version}; this CLI has v${TEMPLATE_VERSION}`,
        "run `armature generate` to update managed files",
      ),
    );
  const drift = scaffoldDrift(dir);
  if (drift.stale.length)
    out.push(
      warn("scaffold", `out of date with armature.yaml: ${list(drift.stale)}`, "run `armature generate`"),
    );
  if (drift.edited.length)
    out.push(
      warn(
        "scaffold",
        `managed files edited by hand, no longer updated: ${list(drift.edited)}`,
        "move the change into armature.yaml or a file you own, then `armature generate --force`",
      ),
    );
  if (!drift.stale.length && !drift.edited.length)
    out.push(ok("scaffold", "managed files match armature.yaml"));
  return out;
}

function secretChecks(dir: string, plan: ProjectPlan, env: NodeJS.ProcessEnv): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  const key = plan.model.api_key_env;
  out.push(
    hasApiKey(dir, env, key)
      ? ok("api key", `${key} is set`)
      : warn(
          "api key",
          `${key} is not set; only offline runs will work`,
          "set it in the environment or .env",
        ),
  );
  for (const t of plan.tools)
    if (t.auth_env && !hasApiKey(dir, env, t.auth_env))
      out.push(
        warn("api key", `${t.auth_env} (tool ${t.name}) is not set`, "set it in the environment or .env"),
      );
  return out;
}

/** One live run through the app with every tool stubbed: checks the key, the model id and tool calling. */
async function runProbe(dir: string, plan: ProjectPlan, env: NodeJS.ProcessEnv): Promise<ProbeResult> {
  const session = await startEvalSession({ dir, offline: false, env, caseTimeoutS: 60 });
  try {
    const tool =
      plan.tools.find((t) => t.side_effect === "read" || t.side_effect === "none") ?? plan.tools[0];
    const input = tool
      ? `This is a connectivity check. Call the ${tool.name} tool once with any valid arguments, then reply with the single word: ok.`
      : "This is a connectivity check. Reply with the single word: ok.";
    const stubs = Object.fromEntries(
      session.manifest.tools.map((t) => [t.name, { result: { ok: true, stub: "armature-doctor" } }]),
    );
    const started = Date.now();
    const res = await session.client.wait({
      input,
      metadata: { eval: { case_id: "armature-doctor-probe", trial: 1, stubs } },
    });
    if (res.status === "error" && res.error) throw new Error(`${res.error.code}: ${res.error.message}`);
    const called = res.tool_calls[0]?.name ?? res.pending_approvals[0]?.name ?? null;
    return {
      status: res.status,
      tool_called: called,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cost_usd: res.usage.cost_usd,
      latency_ms: Date.now() - started,
    };
  } finally {
    await session.stop();
  }
}

function render(io: Io, check: DoctorCheck) {
  const mark = {
    ok: c.green("ok  "),
    warn: c.yellow("warn"),
    fail: c.red("fail"),
    skip: c.dim("skip"),
  }[check.status];
  io.stdout(`${mark}  ${check.name.padEnd(13)}${check.message}\n`);
  if (check.hint && check.status !== "ok") io.stdout(`      ${" ".repeat(13)}${c.dim(check.hint)}\n`);
}

/**
 * Checks what a project needs to run: the spec, the scaffold, the venv and its pins, secrets,
 * and optionally one live model call (--probe) and the ARC conformance suite (--conformance).
 */
export async function doctorCommand(
  io: Io,
  dirArg: string | undefined,
  opts: DoctorOptions,
): Promise<number> {
  const dir = resolve(io.cwd, dirArg ?? ".");
  const checks: DoctorCheck[] = [];
  const add = (...more: DoctorCheck[]) => {
    for (const ch of more) {
      checks.push(ch);
      if (!opts.json) render(io, ch);
    }
  };
  let probe: ProbeResult | null = null;
  let conformance: ConformanceReport | null = null;

  const node = process.versions.node;
  add(
    major(node) >= 22
      ? ok("node", `Node ${node}`)
      : fail("node", `Node ${node}; Armature needs 22 or later`, ExitCode.environment),
  );
  const uv = spawnSync("uv", ["--version"], { encoding: "utf8" });
  add(
    uv.status === 0
      ? ok("uv", uv.stdout.trim())
      : warn("uv", "uv is not on PATH", "install it from https://docs.astral.sh/uv/ to create the venv"),
  );

  let plan: ProjectPlan | null = null;
  try {
    const { spec } = loadSpec(join(dir, SPEC_FILE));
    const compiled = compile(spec, { allowExperimental: true });
    plan = compiled.plan;
    const m = plan.model;
    add(ok("spec", `${plan.name}: ${plan.framework} · ${plan.pattern} · ${m.provider}/${m.id}`));
    add(
      m.known
        ? ok("model", `${m.id} is in the verified catalog`)
        : warn(
            "model",
            `${m.provider}/${m.id} is not in the verified catalog; cost is NOT_MEASURED`,
            "run `armature doctor --probe` to check that it answers and calls tools",
          ),
    );
  } catch (err) {
    const f = toFailure(err);
    add(
      fail(
        "spec",
        f.message +
          (f.issues?.length
            ? `: ${f.issues.map((i) => `${i.path || "(root)"} ${i.message}`).join("; ")}`
            : ""),
        f.exit_code,
        f.hint,
      ),
    );
  }

  if (plan) {
    add(...lockChecks(dir));
    add(...pythonChecks(dir, plan, io.env));
    add(...secretChecks(dir, plan, io.env));
    const ready = !checks.some((ch) => ch.status === "fail");

    if (opts.probe) {
      if (!ready) add(skip("probe", "fix the failures above first"));
      else if (!hasApiKey(dir, io.env, plan.model.api_key_env))
        add(
          fail(
            "probe",
            `${plan.model.api_key_env} is not set`,
            ExitCode.environment,
            "set it, then probe again",
          ),
        );
      else {
        try {
          probe = await runProbe(dir, plan, io.env);
          const cost = probe.cost_usd === null ? "cost NOT_MEASURED" : `$${probe.cost_usd.toFixed(5)}`;
          const usage = `${probe.input_tokens}+${probe.output_tokens} tokens, ${cost}, ${probe.latency_ms} ms`;
          add(
            !plan.tools.length || probe.tool_called
              ? ok(
                  "probe",
                  `${plan.model.id} answered${probe.tool_called ? ` and called ${probe.tool_called}` : ""} (${usage})`,
                )
              : warn(
                  "probe",
                  `${plan.model.id} answered without calling a tool (${usage})`,
                  "tool calling may not work with this model or endpoint",
                ),
          );
        } catch (err) {
          add(
            fail(
              "probe",
              toFailure(err).message,
              ExitCode.environment,
              "check the key, model id and base_url",
            ),
          );
        }
      }
    }

    if (opts.conformance) {
      if (!ready) add(skip("conformance", "fix the failures above first"));
      else {
        try {
          conformance = await projectConformance({
            dir,
            package: plan.package,
            env: io.env,
            ...(opts.json ? {} : { onCheck: (r: CheckResult) => renderConformance(io, r) }),
          });
          const failed = conformance.checks.filter((ch) => ch.status === "FAIL");
          add(
            failed.length
              ? fail(
                  "conformance",
                  `${failed.length} of ${conformance.checks.length} ARC checks failed: ${failed.map((f) => f.key).join(", ")}`,
                  ExitCode.validation,
                )
              : ok("conformance", `ARC v1: ${conformance.checks.length} checks passed`),
          );
        } catch (err) {
          const f = toFailure(err);
          add(fail("conformance", f.message, f.exit_code, f.hint));
        }
      }
    }
  }

  const failed = checks.find((ch) => ch.status === "fail");
  const code = failed?.exit_code ?? ExitCode.ok;
  if (opts.json) {
    printJson(io, {
      ok: !failed,
      command: "doctor",
      dir,
      checks,
      ...(opts.probe ? { probe } : {}),
      ...(opts.conformance ? { conformance } : {}),
    });
  } else {
    const warns = checks.filter((ch) => ch.status === "warn").length;
    io.stdout(
      `\n${failed ? c.red("not ready") : c.green("ready")}${warns ? c.dim(` · ${warns} warning(s)`) : ""}\n`,
    );
  }
  return code;
}

export function renderConformance(io: Io, r: CheckResult) {
  const mark = r.status === "PASS" ? c.green("PASS") : r.status === "FAIL" ? c.red("FAIL") : c.dim("N/A ");
  io.stdout(`      ${mark} ${r.id}. ${r.title} ${c.dim(`${r.duration_ms} ms`)}\n`);
  if (r.status === "FAIL") for (const d of r.details) io.stdout(`           ${c.dim(d)}\n`);
}
