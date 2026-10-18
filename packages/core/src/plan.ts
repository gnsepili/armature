import type { AgentSpec, CustomTool, SideEffect } from "@armature/schema";
import { findModel, versionsCatalog } from "./catalog.ts";
import { pythonPackageName } from "./compat.ts";

const PY_TYPES = { string: "str", integer: "int", number: "float", boolean: "bool" } as const;
const JSON_TYPES = { string: "string", integer: "integer", number: "number", boolean: "boolean" } as const;

export interface PlannedArg {
  name: string;
  type: keyof typeof PY_TYPES;
  py_type: string;
  description: string;
  required: boolean;
}

export interface PlannedTool {
  name: string;
  /** PascalCase, used for the generated pydantic argument model. */
  class_name: string;
  description: string;
  side_effect: SideEffect;
  mode: "stub" | "implemented";
  idempotent: boolean;
  timeout_s: number;
  auth_env: string | null;
  requires_approval: boolean;
  args: PlannedArg[];
  input_schema: Record<string, unknown>;
  /** True for the example tools added when the spec declares none. */
  example: boolean;
}

export interface Dependency {
  name: string;
  version: string;
}

/** Everything a template needs, derived once from a validated spec. Every field is always present. */
export interface ProjectPlan {
  name: string;
  description: string;
  package: string;
  framework: string;
  pattern: string;
  python_version: string;
  python_requires: string;
  model: {
    provider: string;
    id: string;
    base_url: string | null;
    api_key_env: string;
    temperature: number | null;
    max_output_tokens: number | null;
    known: boolean;
    price_input: number | null;
    price_output: number | null;
  };
  intent: {
    problem: string;
    target_user: string;
    success_criteria: string[];
    prohibited_actions: string[];
    write_scope: string;
    examples: { request: string; desired_outcome: string }[];
  };
  tools: PlannedTool[];
  has_tools: boolean;
  has_approval_tools: boolean;
  approvals: { write: "require" | "allow"; destructive: "require" | "allow" };
  limits: {
    max_steps: number;
    max_tool_calls: number;
    max_tokens: number;
    max_cost_usd: number;
    timeout_s: number;
  };
  session_memory: { enabled: boolean; backend: "memory" | "sqlite" };
  structured_output: { enabled: boolean; schema: Record<string, unknown> | null };
  interfaces: string[];
  assistant: { targets: string[]; docs_mcp: boolean };
  telemetry: { capture_content: boolean };
  evaluation: { spec: string };
  dependencies: Dependency[];
  dev_dependencies: Dependency[];
  build_requires: Dependency[];
}

const DEFAULT_KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai_compatible: "OPENAI_API_KEY",
};

const EXAMPLE_TOOLS: CustomTool[] = [
  {
    name: "lookup_item",
    description: "Look up an item by its id and return its details.",
    side_effect: "read",
    mode: "stub",
    idempotent: true,
    timeout_s: 30,
    args: [
      { name: "item_id", type: "string", description: "The id of the item to look up.", required: true },
    ],
  },
  {
    name: "save_note",
    description: "Save a short note for the user.",
    side_effect: "write",
    mode: "stub",
    timeout_s: 30,
    args: [{ name: "text", type: "string", description: "The note to save.", required: true }],
  },
];

const pascal = (s: string) =>
  s
    .split(/[_-]/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");

function planTool(tool: CustomTool, approvals: ProjectPlan["approvals"], example: boolean): PlannedTool {
  const args: PlannedArg[] = tool.args.map((a) => ({
    name: a.name,
    type: a.type,
    py_type: PY_TYPES[a.type],
    description: a.description ?? "",
    required: a.required ?? true,
  }));
  const properties: Record<string, unknown> = {};
  for (const a of args)
    properties[a.name] = {
      type: JSON_TYPES[a.type],
      ...(a.description ? { description: a.description } : {}),
    };
  const required = args.filter((a) => a.required).map((a) => a.name);
  const requiresApproval =
    (tool.side_effect === "write" && approvals.write === "require") ||
    (tool.side_effect === "destructive" && approvals.destructive === "require");
  return {
    name: tool.name,
    class_name: pascal(tool.name),
    description: tool.description,
    side_effect: tool.side_effect,
    mode: tool.mode,
    idempotent: tool.idempotent ?? (tool.side_effect === "none" || tool.side_effect === "read"),
    timeout_s: tool.timeout_s,
    auth_env: tool.auth_env ?? null,
    requires_approval: requiresApproval,
    args,
    input_schema: { type: "object", properties, required, additionalProperties: false },
    example,
  };
}

const deps = (record: Record<string, string>): Dependency[] =>
  Object.entries(record).map(([name, version]) => ({ name, version }));

export function planDependencies(spec: AgentSpec): Dependency[] {
  const pins = versionsCatalog.frameworks[spec.runtime.framework];
  if (!pins) return [];
  const all = new Map<string, string>();
  const add = (r: Record<string, string> | undefined) => {
    for (const [k, v] of Object.entries(r ?? {})) all.set(k, v);
  };
  add(versionsCatalog.common);
  add(pins.packages);
  add(pins.providers[spec.model.provider]);
  if (spec.capabilities.session_memory.enabled)
    add(pins.session_backends[spec.capabilities.session_memory.backend]);
  return [...all.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, version]) => ({ name, version }));
}

export function planProject(spec: AgentSpec): ProjectPlan {
  const approvals = spec.policies.approvals;
  const declared = spec.capabilities.custom_tools;
  const tools = (declared.length ? declared : EXAMPLE_TOOLS).map((t) =>
    planTool(t, approvals, !declared.length),
  );
  const entry = findModel(spec.model.provider, spec.model.id);
  const so = spec.capabilities.structured_output;
  return {
    name: spec.name,
    description: spec.description ?? "",
    package: pythonPackageName(spec.name),
    framework: spec.runtime.framework,
    pattern: spec.runtime.pattern,
    python_version: spec.runtime.python_version,
    python_requires: `>=${spec.runtime.python_version}`,
    model: {
      provider: spec.model.provider,
      id: spec.model.id,
      base_url: spec.model.base_url ?? null,
      api_key_env: spec.model.api_key_env ?? DEFAULT_KEY_ENV[spec.model.provider] ?? "OPENAI_API_KEY",
      temperature: spec.model.params?.temperature ?? null,
      max_output_tokens: spec.model.params?.max_output_tokens ?? null,
      known: Boolean(entry),
      price_input: entry?.price.input ?? null,
      price_output: entry?.price.output ?? null,
    },
    intent: {
      problem: spec.intent.problem,
      target_user: spec.intent.target_user ?? "",
      success_criteria: spec.intent.success_criteria ?? [],
      prohibited_actions: spec.intent.prohibited_actions ?? [],
      write_scope: spec.intent.write_scope ?? "",
      examples: (spec.intent.examples ?? []).map((e) => ({
        request: e.request,
        desired_outcome: e.desired_outcome ?? "",
      })),
    },
    tools,
    has_tools: tools.length > 0,
    has_approval_tools: tools.some((t) => t.requires_approval),
    approvals: { write: approvals.write, destructive: approvals.destructive },
    limits: { ...spec.policies.limits },
    session_memory: { ...spec.capabilities.session_memory },
    structured_output: { enabled: so.enabled, schema: so.enabled ? (so.schema ?? null) : null },
    interfaces: [...spec.interfaces],
    assistant: { targets: [...spec.assistant.targets], docs_mcp: spec.assistant.docs_mcp },
    telemetry: { capture_content: spec.telemetry.capture_content },
    evaluation: { spec: spec.evaluation.spec },
    dependencies: planDependencies(spec),
    dev_dependencies: deps(versionsCatalog.dev),
    build_requires: deps(versionsCatalog.build),
  };
}
