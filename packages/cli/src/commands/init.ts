import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { ArmatureError, ExitCode, generate, SPEC_FILE } from "@armature/core";
import { parse as parseYaml } from "yaml";
import { c, type Io, printJson } from "../io.ts";
import { generateJson, printActions, printCompat } from "../report.ts";
import { type RawSpec, type SpecFlags, slugify, specFromFlags, specToYaml } from "../spec.ts";
import { runWizard } from "../wizard.ts";

export interface InitOptions extends SpecFlags {
  output?: string;
  yes?: boolean;
  config?: string;
  dryRun?: boolean;
  force?: boolean;
  experimental?: boolean;
  json?: boolean;
}

async function readConfig(io: Io, source: string): Promise<RawSpec> {
  let text: string;
  try {
    text = source === "-" ? await io.readStdin() : readFileSync(resolve(io.cwd, source), "utf8");
  } catch {
    throw new ArmatureError(`cannot read --config ${source}`, ExitCode.validation);
  }
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (err) {
    throw new ArmatureError(
      `--config ${source} is not valid YAML or JSON: ${(err as Error).message}`,
      ExitCode.validation,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ArmatureError(`--config ${source} must contain a mapping`, ExitCode.validation);
  return value as RawSpec;
}

export async function initCommand(io: Io, dirArg: string | undefined, opts: InitOptions): Promise<number> {
  const base = opts.config ? await readConfig(io, opts.config) : undefined;
  const fallbackName = slugify(opts.name ?? base?.name ?? "my-agent");
  const dir = resolve(io.cwd, opts.output ?? dirArg ?? fallbackName);
  const specPath = resolve(dir, SPEC_FILE);
  if (existsSync(specPath) && !opts.force)
    throw new ArmatureError(
      `${specPath} already exists`,
      ExitCode.overwriteRefused,
      "run `armature generate` to update the project, or pass --force to start over",
    );

  const interactive = io.interactive && !opts.yes && !opts.config && !opts.json;
  const spec = interactive ? await runWizard(opts.name ?? fallbackName, dir) : specFromFlags(opts, dir, base);
  const yamlText = specToYaml(spec);
  const result = generate({
    dir,
    specText: yamlText,
    specPath,
    dryRun: opts.dryRun,
    force: opts.force,
    // The wizard already warned about uncatalogued models.
    allowExperimental: interactive || Boolean(opts.experimental),
  });
  if (!result.dryRun) writeFileSync(specPath, yamlText);

  if (opts.json) {
    printJson(io, { ...generateJson("init", result), spec: SPEC_FILE });
    return ExitCode.ok;
  }
  printCompat(io, result.compat);
  printActions(io, result.actions, result.dryRun);
  if (result.dryRun) return ExitCode.ok;
  const rel = relative(io.cwd, dir) || ".";
  const key = result.plan.model.api_key_env;
  const stubs = result.plan.tools.filter((t) => t.mode === "stub").map((t) => t.name);
  io.stdout(
    [
      "",
      `${c.green("Created")} ${c.bold(result.plan.name)} (${result.plan.framework}) in ${rel}`,
      "",
      "Next:",
      `  cd ${rel}`,
      "  uv sync --extra dev",
      `  armature dev --offline       ${c.dim("# playground on the mock model, no API key")}`,
      `  export ${key}=...  &&  armature dev`,
      `  claude  ${c.dim("then /build-agent")}   ${c.dim("# or codex, reading AGENTS.md")}`,
      ...(stubs.length
        ? ["", c.dim(`Stub tools to implement: ${stubs.join(", ")} (src/${result.plan.package}/tools/)`)]
        : []),
      "",
    ].join("\n"),
  );
  return ExitCode.ok;
}
