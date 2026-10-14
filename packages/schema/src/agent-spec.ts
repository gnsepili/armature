import { z } from "zod";

export const SLUG = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
export const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export const Framework = z.enum(["langgraph", "openai-agents"]);
export const KnownFramework = z.enum([
  "langgraph",
  "openai-agents",
  "pydantic-ai",
  "agno",
  "adk",
  "claude-agent-sdk",
  "crewai",
  "vercel-ai-sdk",
  "mastra",
]);
export const Pattern = z.enum(["single_agent_tools", "workflow", "supervisor", "rag_chat"]);
export const Provider = z.enum(["openai", "anthropic", "openai_compatible"]);
export const ModelCapability = z.enum(["tool_calling", "streaming", "structured_output"]);
export const SideEffect = z.enum(["none", "read", "write", "destructive"]);
export const Interface = z.enum(["terminal", "web_playground", "rest_openapi", "sse", "websocket"]);
export const AssistantTarget = z.enum(["claude", "codex", "generic"]);

export const ToolArg = z
  .object({
    name: z.string().regex(TOOL_NAME, "argument names are lowercase snake_case"),
    type: z.enum(["string", "integer", "number", "boolean"]).default("string"),
    description: z.string().default(""),
    required: z.boolean().default(true),
  })
  .strict();

export const CustomTool = z
  .object({
    name: z.string().regex(TOOL_NAME, "tool names are lowercase snake_case, at most 64 characters"),
    description: z.string().min(1).default("TODO: describe what this tool does and when to use it."),
    side_effect: SideEffect.default("read"),
    mode: z.enum(["stub", "implemented"]).default("stub"),
    args: z.array(ToolArg).default([]),
    idempotent: z.boolean().optional(),
    timeout_s: z.number().positive().max(600).default(30),
    auth_env: z.string().optional(),
  })
  .strict();

export const Example = z
  .object({
    request: z.string().min(1),
    desired_outcome: z.string().default(""),
  })
  .strict();

export const Intent = z
  .object({
    problem: z.string().default(""),
    target_user: z.string().default(""),
    examples: z.array(Example).default([]),
    success_criteria: z.array(z.string()).default([]),
    prohibited_actions: z.array(z.string()).default([]),
    write_scope: z.string().default(""),
    ground_truth_sources: z.array(z.string()).default([]),
  })
  .strict();

export const Limits = z
  .object({
    max_steps: z.number().int().positive().default(15),
    max_tool_calls: z.number().int().positive().default(30),
    max_tokens: z.number().int().positive().default(200_000),
    max_cost_usd: z.number().positive().default(1),
    timeout_s: z.number().positive().default(120),
  })
  .strict();

export const AgentSpec = z
  .object({
    schema_version: z.literal(1),
    name: z.string().regex(SLUG, "name must be a lowercase slug (letters, digits, hyphens), 3-64 characters"),
    description: z.string().default(""),
    intent: Intent.default(Intent.parse({})),
    runtime: z
      .object({
        language: z.enum(["python", "typescript"]).default("python"),
        framework: KnownFramework,
        pattern: Pattern.default("single_agent_tools"),
        python_version: z
          .string()
          .regex(/^3\.\d+$/)
          .default("3.12"),
      })
      .strict(),
    model: z
      .object({
        provider: Provider,
        id: z.string().min(1),
        base_url: z.string().url().optional(),
        api_key_env: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]*$/)
          .optional(),
        params: z
          .object({
            temperature: z.number().min(0).max(2).optional(),
            max_output_tokens: z.number().int().positive().optional(),
          })
          .strict()
          .default({}),
        required_capabilities: z.array(ModelCapability).default(["tool_calling", "streaming"]),
      })
      .strict(),
    capabilities: z
      .object({
        session_memory: z
          .object({
            enabled: z.boolean().default(true),
            backend: z.enum(["memory", "sqlite"]).default("memory"),
          })
          .strict()
          .default({ enabled: true, backend: "memory" }),
        custom_tools: z.array(CustomTool).default([]),
        structured_output: z
          .preprocess(
            (v) => (typeof v === "boolean" ? { enabled: v } : v),
            z
              .object({
                enabled: z.boolean().default(false),
                schema: z.record(z.string(), z.unknown()).optional(),
              })
              .strict(),
          )
          .default({ enabled: false }),
        rag: z
          .object({ enabled: z.boolean().default(false) })
          .catchall(z.unknown())
          .default({ enabled: false }),
        mcp: z
          .object({ servers: z.array(z.record(z.string(), z.unknown())).default([]) })
          .strict()
          .default({ servers: [] }),
      })
      .strict()
      .default({
        session_memory: { enabled: true, backend: "memory" },
        custom_tools: [],
        structured_output: { enabled: false },
        rag: { enabled: false },
        mcp: { servers: [] },
      }),
    policies: z
      .object({
        approvals: z
          .object({
            write: z.enum(["require", "allow"]).default("require"),
            destructive: z.enum(["require", "allow"]).default("require"),
          })
          .strict()
          .default({ write: "require", destructive: "require" }),
        limits: Limits.default(Limits.parse({})),
      })
      .strict()
      .default({ approvals: { write: "require", destructive: "require" }, limits: Limits.parse({}) }),
    interfaces: z.array(Interface).default(["terminal", "web_playground", "rest_openapi", "sse"]),
    assistant: z
      .object({
        targets: z.array(AssistantTarget).min(1).default(["claude", "codex"]),
        docs_mcp: z.boolean().default(true),
      })
      .strict()
      .default({ targets: ["claude", "codex"], docs_mcp: true }),
    telemetry: z
      .object({ capture_content: z.boolean().default(false) })
      .strict()
      .default({ capture_content: false }),
    evaluation: z
      .object({ spec: z.string().default("evals/evalspec.yaml") })
      .strict()
      .default({ spec: "evals/evalspec.yaml" }),
    generation: z.object({ template_version: z.string().optional() }).strict().default({}),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.capabilities.structured_output.enabled && !spec.capabilities.structured_output.schema) {
      ctx.addIssue({
        code: "custom",
        path: ["capabilities", "structured_output", "schema"],
        message: "structured_output needs a JSON Schema object under `schema`",
      });
    }
    const names = new Set<string>();
    for (const [i, tool] of spec.capabilities.custom_tools.entries()) {
      if (names.has(tool.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["capabilities", "custom_tools", i, "name"],
          message: `duplicate tool name "${tool.name}"`,
        });
      }
      names.add(tool.name);
    }
    if (spec.model.provider === "openai_compatible" && !spec.model.base_url) {
      ctx.addIssue({
        code: "custom",
        path: ["model", "base_url"],
        message: "openai_compatible providers need model.base_url",
      });
    }
  });

export type AgentSpec = z.infer<typeof AgentSpec>;
export type AgentSpecInput = z.input<typeof AgentSpec>;
export type CustomTool = z.infer<typeof CustomTool>;
export type SideEffect = z.infer<typeof SideEffect>;
