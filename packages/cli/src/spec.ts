import { basename } from "node:path";
import { ArmatureError, ExitCode, suggestedModels } from "@armature/core";
import {
  type AgentSpecInput,
  AssistantTarget,
  KnownFramework,
  Pattern,
  Provider,
  SideEffect,
} from "@armature/schema";
import { stringify } from "yaml";

/** Flags shared by `init` (and the wizard's answers) that shape a new armature.yaml. */
/** A spec as the user wrote it, before schema validation. */
// biome-ignore lint/suspicious/noExplicitAny: unvalidated input; parseAgentSpec checks it.
export type RawSpec = Record<string, any>;

export interface SpecFlags {
  name?: string;
  description?: string;
  framework?: string;
  pattern?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  with?: string[];
  tool?: string[];
  assistant?: string[];
}

export const DEFAULTS = {
  framework: "langgraph",
  pattern: "single_agent_tools",
  provider: "openai",
} as const;

/** Capability tokens accepted by `--with`. Kept small and documented in docs/cli.md. */
export const WITH_TOKENS = ["memory", "memory:sqlite", "no-memory"] as const;

const oneOf = (flag: string, value: string, allowed: readonly string[]) => {
  if (!allowed.includes(value))
    throw new ArmatureError(
      `${flag} must be one of ${allowed.join(", ")} (got "${value}")`,
      ExitCode.validation,
    );
  return value;
};

/** Turns a directory name into a valid agent slug, or falls back to "my-agent". */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : "my-agent";
}

export const splitList = (values: string[] | undefined): string[] =>
  (values ?? [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * Parses `--tool name:side_effect:arg1,arg2`. Args are strings; edit armature.yaml for
 * types and descriptions.
 */
export function parseToolFlag(value: string) {
  const [name = "", sideEffect = "read", args = ""] = value.split(":");
  oneOf("--tool side effect", sideEffect, SideEffect.options);
  return {
    name,
    side_effect: sideEffect as (typeof SideEffect.options)[number],
    args: args
      .split(/[,+]/)
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => ({ name: a })),
  };
}

function assistantTargets(values: string[]): (typeof AssistantTarget.options)[number][] {
  const out = new Set<string>();
  for (const v of values) {
    if (v === "both") {
      out.add("claude");
      out.add("codex");
    } else out.add(oneOf("--assistant", v, [...AssistantTarget.options, "both"]));
  }
  return [...out] as (typeof AssistantTarget.options)[number][];
}

/** The model to suggest for a provider when the user does not pick one. */
export function defaultModel(provider: string): string | undefined {
  return suggestedModels(provider)[0]?.id;
}

/**
 * Builds a raw spec from flags, on top of `base` (a --config file) when given. Flags win
 * over the base. The result still goes through schema validation in `generate`.
 */
export function specFromFlags(flags: SpecFlags, dir: string, base?: RawSpec): AgentSpecInput {
  const spec: RawSpec = structuredClone(base ?? {});
  spec.schema_version ??= 1;
  spec.name = flags.name ?? spec.name ?? slugify(basename(dir));
  if (flags.description !== undefined) spec.description = flags.description;

  spec.runtime ??= {};
  const runtime = spec.runtime;
  if (flags.framework) runtime.framework = oneOf("--framework", flags.framework, KnownFramework.options);
  runtime.framework ??= DEFAULTS.framework;
  if (flags.pattern) runtime.pattern = oneOf("--pattern", flags.pattern, Pattern.options);
  runtime.pattern ??= DEFAULTS.pattern;

  spec.model ??= {};
  const model = spec.model;
  if (flags.provider) {
    if (model.provider && model.provider !== flags.provider && !flags.model) delete model.id;
    model.provider = oneOf("--provider", flags.provider, Provider.options);
  }
  model.provider ??= DEFAULTS.provider;
  if (flags.model) model.id = flags.model;
  if (flags.baseUrl) model.base_url = flags.baseUrl;
  if (!model.id) {
    const id = defaultModel(model.provider);
    if (!id)
      throw new ArmatureError(
        `pick a model for provider ${model.provider}`,
        ExitCode.validation,
        "pass --model <id>",
      );
    model.id = id;
  }

  spec.capabilities ??= {};
  const caps = spec.capabilities;
  for (const token of splitList(flags.with)) {
    oneOf("--with", token, WITH_TOKENS);
    if (token === "no-memory") caps.session_memory = { enabled: false, backend: "memory" };
    else caps.session_memory = { enabled: true, backend: token === "memory:sqlite" ? "sqlite" : "memory" };
  }
  const tools = splitToolFlags(flags.tool);
  if (tools.length) caps.custom_tools = [...(caps.custom_tools ?? []), ...tools.map(parseToolFlag)];
  if (Object.keys(caps).length === 0) delete spec.capabilities;

  const targets = splitList(flags.assistant);
  if (targets.length) spec.assistant = { ...(spec.assistant ?? {}), targets: assistantTargets(targets) };
  return spec as AgentSpecInput;
}

/** `--tool a:read:x,y --tool b:write` — commas inside one value separate args, not tools. */
const splitToolFlags = (values: string[] | undefined) => (values ?? []).map((v) => v.trim()).filter(Boolean);

const KEY_ORDER = [
  "schema_version",
  "name",
  "description",
  "intent",
  "runtime",
  "model",
  "capabilities",
  "policies",
  "interfaces",
  "assistant",
  "telemetry",
  "evaluation",
  "generation",
];

const HEADER = [
  "# yaml-language-server: $schema=https://raw.githubusercontent.com/gnsepili/armature/main/schemas/armature.schema.json",
  "# Armature agent spec. Edit it, then run `armature generate` to update the project.",
  "",
].join("\n");

/** Deterministic YAML for a spec object: fixed top-level key order, no timestamps. */
export function specToYaml(spec: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) if (spec[key] !== undefined) ordered[key] = spec[key];
  for (const key of Object.keys(spec)) if (!(key in ordered)) ordered[key] = spec[key];
  return HEADER + stringify(ordered, { lineWidth: 100 });
}
