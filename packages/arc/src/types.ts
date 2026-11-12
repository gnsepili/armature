import { z } from "zod";

/** ARC (Agent Runtime Contract) v1 wire types. See docs/adr/0002-arc-v1.md. */
export const ARC_VERSION = 1 as const;

export const SideEffect = z.enum(["none", "read", "write", "destructive"]);

export const Health = z
  .object({
    status: z.literal("ok"),
    arc_version: z.literal(ARC_VERSION),
    framework: z.string(),
    eval_mode: z.boolean(),
    model_mode: z.enum(["live", "mock"]),
    /** Non-secret readiness facts, e.g. whether credentials are present. */
    ready: z.record(z.string(), z.boolean()).default({}),
  })
  .loose();
export type Health = z.infer<typeof Health>;

export const ManifestTool = z
  .object({
    name: z.string(),
    description: z.string(),
    input_schema: z.record(z.string(), z.unknown()),
    side_effect: SideEffect,
    requires_approval: z.boolean(),
  })
  .loose();
export type ManifestTool = z.infer<typeof ManifestTool>;

export const Manifest = z
  .object({
    arc_version: z.literal(ARC_VERSION),
    name: z.string(),
    description: z.string().default(""),
    framework: z.string(),
    pattern: z.string(),
    model: z.object({ provider: z.string(), id: z.string() }).loose(),
    tools: z.array(ManifestTool),
    limits: z
      .object({
        max_steps: z.number().int().positive(),
        max_tool_calls: z.number().int().positive(),
        max_tokens: z.number().int().positive(),
        max_cost_usd: z.number().positive(),
        timeout_s: z.number().positive(),
      })
      .loose(),
    capabilities: z
      .object({
        session_memory: z.boolean(),
        streaming: z.boolean(),
        approvals: z.boolean(),
        edited_args: z.boolean(),
        structured_output: z
          .object({ enabled: z.boolean(), schema: z.record(z.string(), z.unknown()).optional() })
          .loose(),
      })
      .loose(),
  })
  .loose();
export type Manifest = z.infer<typeof Manifest>;

export const InputMessage = z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).strict();

export const EvalMetadata = z
  .object({
    case_id: z.string().optional(),
    trial: z.number().int().positive().optional(),
    fixtures: z.record(z.string(), z.unknown()).optional(),
    stubs: z
      .record(
        z.string(),
        z.object({
          result: z.unknown().optional(),
          error: z.string().optional(),
          delay_ms: z.number().optional(),
        }),
      )
      .optional(),
  })
  .strict();

export const RunRequest = z
  .object({
    thread_id: z.string().min(1).optional(),
    input: z.union([z.string().min(1), z.array(InputMessage).min(1)]),
    metadata: z.object({ eval: EvalMetadata.optional() }).catchall(z.unknown()).optional(),
  })
  .strict();
export type RunRequest = z.input<typeof RunRequest>;

export const Message = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
    tool_calls: z.array(z.object({ id: z.string(), name: z.string(), args: z.unknown() }).loose()).optional(),
    tool_call_id: z.string().optional(),
  })
  .loose();

export const ToolCallStatus = z.enum(["pending_approval", "completed", "error", "denied"]);
export const ToolCallRecord = z
  .object({
    id: z.string(),
    name: z.string(),
    args: z.unknown(),
    side_effect: SideEffect,
    status: ToolCallStatus,
    approval: z.enum(["not_required", "pending", "approved", "denied"]),
    result: z.unknown().optional(),
    error: z.string().nullable().optional(),
    duration_ms: z.number().nonnegative().nullable().optional(),
    stubbed: z.boolean().default(false),
  })
  .loose();
export type ToolCallRecord = z.infer<typeof ToolCallRecord>;

export const Usage = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    model_calls: z.number().int().nonnegative(),
    /** null means NOT_MEASURED (unknown pricing); never guessed. */
    cost_usd: z.number().nonnegative().nullable(),
  })
  .loose();
export type Usage = z.infer<typeof Usage>;

export const ErrorCode = z.enum([
  "limit_exceeded",
  "timeout",
  "model_error",
  "tool_error",
  "structured_output_invalid",
  "invalid_request",
  "internal",
]);
export const RunError = z.object({ code: ErrorCode, message: z.string() }).loose();

export const PendingApproval = z
  .object({ tool_call_id: z.string(), name: z.string(), args: z.unknown(), side_effect: SideEffect })
  .loose();

export const RunStatus = z.enum(["success", "error", "interrupted"]);
export const RunResult = z
  .object({
    run_id: z.string(),
    thread_id: z.string(),
    status: RunStatus,
    output: z.unknown(),
    messages: z.array(Message),
    tool_calls: z.array(ToolCallRecord),
    usage: Usage,
    pending_approvals: z.array(PendingApproval),
    error: RunError.nullable(),
  })
  .loose();
export type RunResult = z.infer<typeof RunResult>;

export const SpanOperation = z.enum(["invoke_agent", "chat", "execute_tool"]);
export const Span = z
  .object({
    span_id: z.string(),
    parent_id: z.string().nullable(),
    name: z.string(),
    operation: SpanOperation,
    start_ms: z.number(),
    end_ms: z.number().nullable(),
    status: z.enum(["ok", "error", "unset"]).default("unset"),
    attributes: z.record(z.string(), z.unknown()).default({}),
  })
  .loose();
export type Span = z.infer<typeof Span>;

export const RunRecord = RunResult.extend({
  spans: z.array(Span),
  approvals: z.array(
    z
      .object({ tool_call_id: z.string(), decision: z.enum(["approved", "denied"]), edited: z.boolean() })
      .loose(),
  ),
  duration_ms: z.number().nonnegative().nullable(),
});
export type RunRecord = z.infer<typeof RunRecord>;

export const Decision = z
  .object({
    tool_call_id: z.string(),
    approve: z.boolean(),
    edited_args: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const ResumeRequest = z
  .object({ decisions: z.array(Decision).min(1), stream: z.boolean().default(false) })
  .strict();
export type ResumeRequest = z.input<typeof ResumeRequest>;

export const Thread = z.object({ thread_id: z.string(), messages: z.array(Message) }).loose();

/** Payloads of Armature's CUSTOM AG-UI events. */
export const ApprovalRequiredValue = z
  .object({ run_id: z.string(), approvals: z.array(PendingApproval).min(1) })
  .loose();
export const UsageValue = z
  .object({
    model: z.string(),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cost_usd: z.number().nonnegative().nullable(),
  })
  .loose();
export const CUSTOM_EVENTS = {
  approvalRequired: "armature.approval_required",
  usage: "armature.usage",
} as const;

export function arcSchemas(): Record<string, unknown> {
  const opts = { io: "output" as const, unrepresentable: "any" as const };
  return {
    "arc-health.schema.json": z.toJSONSchema(Health, opts),
    "arc-manifest.schema.json": z.toJSONSchema(Manifest, opts),
    "arc-run-request.schema.json": z.toJSONSchema(RunRequest, { ...opts, io: "input" }),
    "arc-run-result.schema.json": z.toJSONSchema(RunResult, opts),
    "arc-run-record.schema.json": z.toJSONSchema(RunRecord, opts),
    "arc-resume-request.schema.json": z.toJSONSchema(ResumeRequest, { ...opts, io: "input" }),
  };
}
