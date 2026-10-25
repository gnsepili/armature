import { join, resolve } from "node:path";
import { applyFiles, compile, ExitCode, loadSpec, readLock, SPEC_FILE } from "@armature/core";
import { c, type Io, printJson } from "../io.ts";
import { countActions } from "../report.ts";

export interface PlanOptions {
  spec?: string;
  experimental?: boolean;
  json?: boolean;
}

/** Explains what `generate` would build and change, without writing anything. */
export function planCommand(io: Io, dirArg: string | undefined, opts: PlanOptions): number {
  const dir = resolve(io.cwd, dirArg ?? ".");
  const { spec } = loadSpec(opts.spec ? resolve(io.cwd, opts.spec) : join(dir, SPEC_FILE));
  const { plan, compat, files } = compile(spec, { allowExperimental: true });
  const lock = readLock(dir);
  const { actions } = applyFiles({ dir, files, previous: lock, dryRun: true });
  const secrets = [
    plan.model.api_key_env,
    ...plan.tools.flatMap((t) => (t.auth_env ? [t.auth_env] : [])),
  ].filter((v, i, all) => all.indexOf(v) === i);
  const tasks = plan.tools
    .filter((t) => t.mode === "stub")
    .map((t) => `implement tool ${t.name} in src/${plan.package}/tools/${t.name}.py`);
  if (compat.status === "experimental" && !opts.experimental)
    tasks.unshift("pass --experimental to generate: the model or endpoint is not in the verified catalog");

  if (opts.json) {
    printJson(io, {
      ok: true,
      command: "plan",
      dir,
      mode: lock ? "update" : "init",
      plan,
      compat,
      files: actions,
      counts: countActions(actions),
      secrets,
      tasks,
    });
    return ExitCode.ok;
  }

  const m = plan.model;
  const price =
    m.price_input === null
      ? c.yellow("cost NOT_MEASURED")
      : `$${m.price_input}/$${m.price_output} per 1M tokens`;
  const l = plan.limits;
  const rows: [string, string][] = [
    ["agent", `${c.bold(plan.name)}${plan.description ? c.dim(`  ${plan.description}`) : ""}`],
    ["stack", `${plan.framework} · ${plan.pattern} · Python ${plan.python_version}`],
    ["model", `${m.provider}/${m.id}${m.known ? "" : c.yellow(" (not in catalog)")} · ${price}`],
    ["compat", compat.status === "supported" ? c.green(compat.status) : c.yellow(compat.status)],
    ["approvals", `write: ${plan.approvals.write}, destructive: ${plan.approvals.destructive}`],
    [
      "limits",
      `${l.max_steps} steps, ${l.max_tool_calls} tool calls, ${l.max_tokens} tokens, $${l.max_cost_usd}, ${l.timeout_s}s`,
    ],
    ["memory", plan.session_memory.enabled ? plan.session_memory.backend : "off"],
    ["output", plan.structured_output.enabled ? "structured (JSON schema)" : "text"],
    ["secrets", secrets.join(", ")],
  ];
  for (const [k, v] of rows) io.stdout(`${c.dim(k.padEnd(10))}${v}\n`);
  for (const f of compat.findings)
    io.stdout(`${" ".repeat(10)}${f.level === "info" ? c.dim("·") : c.yellow("!")} ${f.message}\n`);

  io.stdout(`\n${c.bold("tools")}\n`);
  for (const t of plan.tools) {
    const flags = [
      t.side_effect,
      t.mode,
      t.requires_approval ? "needs approval" : "",
      t.example ? "example" : "",
    ]
      .filter(Boolean)
      .join(", ");
    io.stdout(`  ${t.name.padEnd(22)} ${c.dim(flags)}\n`);
  }

  const counts = Object.entries(countActions(actions)).map(([k, n]) => `${n} ${k}`);
  io.stdout(`\n${c.bold("files")}     ${lock ? "update" : "new project"}: ${counts.join(", ")}\n`);
  for (const a of actions.filter((x) => x.action !== "unchanged" && (lock || x.action !== "create")))
    io.stdout(`  ${a.action.padEnd(14)} ${a.path}\n`);
  io.stdout(`${c.bold("packages")}  ${plan.dependencies.map((d) => `${d.name}==${d.version}`).join(" ")}\n`);
  if (tasks.length) {
    io.stdout(`\n${c.bold("todo")}\n`);
    for (const t of tasks) io.stdout(`  - ${t}\n`);
  }
  return ExitCode.ok;
}
