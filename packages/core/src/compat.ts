import type { AgentSpec } from "@armature/schema";
import { findModel, versionsCatalog } from "./catalog.ts";

export type CompatStatus = "supported" | "degraded" | "experimental" | "unsupported";

export interface Finding {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  path: string;
}

export interface CompatReport {
  status: CompatStatus;
  findings: Finding[];
}

/** Frameworks with a P0 adapter. Others are valid in the schema but not generated yet. */
export const SUPPORTED_FRAMEWORKS = ["langgraph", "openai-agents"] as const;
export const SUPPORTED_PATTERNS = ["single_agent_tools"] as const;

const PYTHON_KEYWORDS = new Set(
  (
    "False None True and as assert async await break class continue def del elif else except finally for " +
    "from global if import in is lambda nonlocal not or pass raise return try while with yield"
  ).split(" "),
);

/** Import names that a generated package must not shadow (stdlib modules and pinned dependencies). */
const RESERVED_PACKAGES = new Set([
  ...(
    "abc ast asyncio base64 builtins collections contextlib contextvars copy csv dataclasses datetime decimal " +
    "email enum functools glob hashlib http importlib inspect io itertools json logging math os pathlib " +
    "pickle platform queue random re secrets select shutil signal site socket sqlite3 ssl string struct " +
    "subprocess sys tempfile test tests threading time tokenize traceback types typing unittest urllib uuid " +
    "warnings weakref xml zipfile"
  ).split(" "),
  ...(
    "agents anthropic fastapi httpx jsonschema langchain langchain_core langchain_openai langchain_anthropic " +
    "langgraph openai pydantic pytest sse_starlette starlette uvicorn armature"
  ).split(" "),
]);

export const pythonPackageName = (slug: string) => slug.replace(/-/g, "_");

export function checkCompatibility(spec: AgentSpec): CompatReport {
  const findings: Finding[] = [];
  const error = (code: string, path: string, message: string) =>
    findings.push({ level: "error", code, path, message });
  const warn = (code: string, path: string, message: string) =>
    findings.push({ level: "warning", code, path, message });
  const info = (code: string, path: string, message: string) =>
    findings.push({ level: "info", code, path, message });

  const { runtime, model, capabilities } = spec;
  let experimental = false;

  if (runtime.language !== "python")
    error(
      "language",
      "runtime.language",
      `only python projects are generated today, got ${runtime.language}`,
    );
  if (!(SUPPORTED_FRAMEWORKS as readonly string[]).includes(runtime.framework))
    error(
      "framework",
      "runtime.framework",
      `${runtime.framework} has no adapter yet; supported: ${SUPPORTED_FRAMEWORKS.join(", ")}`,
    );
  if (!(SUPPORTED_PATTERNS as readonly string[]).includes(runtime.pattern))
    error(
      "pattern",
      "runtime.pattern",
      `pattern ${runtime.pattern} is planned; supported: single_agent_tools`,
    );
  if (!versionsCatalog.python.supported.includes(runtime.python_version))
    error(
      "python_version",
      "runtime.python_version",
      `python ${runtime.python_version} is not tested; supported: ${versionsCatalog.python.supported.join(", ")}`,
    );

  const pins = versionsCatalog.frameworks[runtime.framework];
  if (pins && !(model.provider in pins.providers))
    error(
      "provider",
      "model.provider",
      `${runtime.framework} does not support provider ${model.provider} in this release` +
        (runtime.framework === "openai-agents" ? "; use langgraph for anthropic models" : ""),
    );
  if (
    pins &&
    capabilities.session_memory.enabled &&
    !(capabilities.session_memory.backend in pins.session_backends)
  )
    error(
      "session_backend",
      "capabilities.session_memory.backend",
      `${capabilities.session_memory.backend} sessions are not supported for ${runtime.framework}`,
    );

  if (capabilities.rag.enabled) error("rag", "capabilities.rag", "RAG is planned for a later release");
  if (capabilities.mcp.servers.length) error("mcp", "capabilities.mcp", "MCP tool servers are planned");
  if (spec.interfaces.includes("websocket"))
    error("websocket", "interfaces", "the websocket interface is planned; use sse");

  const pkg = pythonPackageName(spec.name);
  if (RESERVED_PACKAGES.has(pkg))
    error(
      "reserved_name",
      "name",
      `"${spec.name}" would create a Python package that shadows \`${pkg}\`; try "${spec.name}-app"`,
    );

  spec.capabilities.custom_tools.forEach((tool, i) => {
    if (PYTHON_KEYWORDS.has(tool.name))
      error("tool_name", `capabilities.custom_tools.${i}.name`, `"${tool.name}" is a Python keyword`);
    const seen = new Set<string>();
    tool.args.forEach((arg, j) => {
      const path = `capabilities.custom_tools.${i}.args.${j}.name`;
      if (PYTHON_KEYWORDS.has(arg.name)) error("arg_name", path, `"${arg.name}" is a Python keyword`);
      if (seen.has(arg.name)) error("arg_name", path, `duplicate argument "${arg.name}"`);
      seen.add(arg.name);
    });
    if (tool.side_effect !== "none" && tool.side_effect !== "read" && tool.idempotent)
      info(
        "idempotent_write",
        `capabilities.custom_tools.${i}.idempotent`,
        `${tool.name} is marked idempotent, so failed calls are retried`,
      );
  });

  if (model.provider === "openai_compatible") {
    experimental = true;
    info(
      "compatible_endpoint",
      "model.base_url",
      "OpenAI-compatible endpoints vary; tool calling and streaming are checked at runtime",
    );
  } else {
    const entry = findModel(model.provider, model.id);
    if (!entry) {
      experimental = true;
      warn(
        "unknown_model",
        "model.id",
        `${model.provider}/${model.id} is not in models.json; it runs as experimental and cost is NOT_MEASURED`,
      );
    } else {
      const wanted = new Set(model.required_capabilities);
      if (capabilities.structured_output.enabled) wanted.add("structured_output");
      for (const cap of wanted)
        if (!entry.capabilities.includes(cap))
          warn("model_capability", "model.id", `${model.id} is not verified for ${cap}`);
    }
  }

  const hasError = findings.some((f) => f.level === "error");
  const hasWarning = findings.some((f) => f.level === "warning");
  const status: CompatStatus = hasError
    ? "unsupported"
    : experimental
      ? "experimental"
      : hasWarning
        ? "degraded"
        : "supported";
  return { status, findings };
}
