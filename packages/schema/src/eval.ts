import { z } from "zod";

export const CASE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const Suite = z.enum(["smoke", "dev", "heldout", "regression", "candidates"]);
export const Category = z.enum([
  "happy_path",
  "edge_case",
  "ambiguous",
  "out_of_scope",
  "prohibited_action",
  "adversarial",
  "tool_failure",
  "rag_no_answer",
  "rag_conflict",
  "memory_staleness",
  "memory_leakage",
  "multi_turn",
  "contract",
]);
/** Categories where declining or doing nothing is the correct behavior. */
export const REFUSAL_CATEGORIES = new Set<z.infer<typeof Category>>([
  "out_of_scope",
  "prohibited_action",
  "adversarial",
]);
export const Severity = z.enum(["critical", "high", "normal"]);
export const Trust = z.enum(["DRAFT_UNVERIFIED", "REVIEWED", "VERIFIED"]);
export const Origin = z.enum(["seed", "generated", "human", "imported", "captured"]);

const weight = z.number().positive().max(100).default(1);

export const OutputGrader = z
  .object({
    type: z.literal("output"),
    equals: z.string().optional(),
    contains_any: z.array(z.string()).optional(),
    contains_all: z.array(z.string()).optional(),
    not_contains: z.array(z.string()).optional(),
    regex: z.string().optional(),
    json_schema: z.record(z.string(), z.unknown()).optional(),
    not_empty: z.boolean().optional(),
    case_sensitive: z.boolean().default(false),
    weight,
  })
  .strict();

export const ConstraintGrader = z
  .object({
    type: z.literal("constraint"),
    never_call: z.array(z.string()).optional(),
    must_call_any: z.array(z.string()).optional(),
    approval_before: z.array(z.string()).optional(),
    max_steps: z.number().int().positive().optional(),
    max_tool_calls: z.number().int().nonnegative().optional(),
    max_cost_usd: z.number().positive().optional(),
    max_latency_ms: z.number().positive().optional(),
    no_run_error: z.boolean().optional(),
    weight,
  })
  .strict();

export const StateGrader = z
  .object({ type: z.literal("state"), expect: z.record(z.string(), z.unknown()), weight })
  .strict();
export const JudgeGrader = z.object({ type: z.literal("judge"), rubric: z.string(), weight }).strict();
export const CustomGrader = z
  .object({
    type: z.literal("custom"),
    scorer: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
    weight,
  })
  .strict();

export const Grader = z.discriminatedUnion("type", [
  OutputGrader,
  ConstraintGrader,
  StateGrader,
  JudgeGrader,
  CustomGrader,
]);
export type Grader = z.infer<typeof Grader>;
/** Grader types the P0 runner executes; others report NOT_MEASURED. */
export const P0_GRADERS = new Set(["output", "constraint"]);

export const Message = z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).strict();

export const ToolStub = z
  .object({
    result: z.unknown().optional(),
    error: z.string().optional(),
    delay_ms: z.number().int().nonnegative().optional(),
  })
  .strict();

export const EvalCase = z
  .object({
    id: z.string().regex(CASE_ID, "case ids are lowercase slugs"),
    suite: Suite,
    category: Category,
    tags: z.array(z.string()).default([]),
    severity: Severity.default("normal"),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    description: z.string().optional(),
    input: z.union([z.string().min(1), z.array(Message).min(1)]),
    fixtures: z.record(z.string(), z.unknown()).optional(),
    stubs: z.record(z.string(), ToolStub).optional(),
    graders: z.array(Grader).min(1),
    expected_outcome: z.string().optional(),
    reference: z.string().optional(),
    trials: z.number().int().positive().max(50).optional(),
    pass: z.enum(["all", "any"]).default("all"),
    origin: Origin,
    trust: Trust.default("DRAFT_UNVERIFIED"),
    reviewer: z.string().optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCase>;

export const ReferenceStep = z.union([
  z
    .object({
      tool_calls: z
        .array(z.object({ name: z.string(), args: z.record(z.string(), z.unknown()).default({}) }).strict())
        .min(1),
    })
    .strict(),
  z.object({ text: z.string() }).strict(),
]);
export type ReferenceStep = z.infer<typeof ReferenceStep>;

export const ReferenceTrajectory = z
  .object({
    case: z.string().regex(CASE_ID),
    description: z.string().optional(),
    /** Approval decisions applied in order whenever the run pauses for approval. */
    approvals: z.array(z.enum(["approve", "deny"])).default([]),
    steps: z.array(ReferenceStep).min(1),
  })
  .strict();
export type ReferenceTrajectory = z.infer<typeof ReferenceTrajectory>;

const SuiteConfig = z
  .object({
    path: z.string(),
    mode: z.enum(["offline", "live", "any"]).default("any"),
    trials: z.number().int().positive().max(50).default(1),
    report: z.enum(["full", "aggregate_only"]).default("full"),
  })
  .strict();

export const EvalSpec = z
  .object({
    schema_version: z.literal(1).default(1),
    objectives: z
      .object({
        primary: z.literal("task_success").default("task_success"),
        diagnostics: z
          .array(
            z.enum(["tool_correctness", "orchestration", "context_rag", "memory", "safety", "efficiency"]),
          )
          .default(["tool_correctness", "orchestration", "safety", "efficiency"]),
      })
      .strict(),
    suites: z.record(z.string(), SuiteConfig),
    graders: z
      .object({
        /** "outcome" is accepted as a synonym for "output". */
        defaults: z
          .array(z.enum(["output", "outcome", "constraint", "state", "judge", "custom"]))
          .default(["output", "constraint"]),
        judge: z
          .object({
            enabled: z.boolean().default(false),
            model: z.string().optional(),
            requires_consent: z.boolean().default(true),
          })
          .strict()
          .default({ enabled: false, requires_consent: true }),
      })
      .strict()
      .default({ defaults: ["output", "constraint"], judge: { enabled: false, requires_consent: true } }),
    gates: z
      .object({
        critical_failures_allowed: z.number().int().nonnegative().default(0),
        max_task_success_regression: z.number().min(0).max(1).default(0.05),
        fail_on_missing_required_measurements: z.boolean().default(true),
      })
      .strict(),
    targets: z
      .object({
        dev_pass_k: z.number().min(0).max(1).optional(),
        max_dev_heldout_gap: z.number().min(0).max(1).optional(),
        max_cost_per_task_usd: z.number().positive().optional(),
      })
      .strict()
      .default({}),
    min_dev_cases: z.number().int().positive().default(20),
    run_policy: z
      .object({
        tool_mode: z.literal("sandbox").default("sandbox"),
        max_cost_usd_per_run: z.number().positive().default(5),
        concurrency: z.number().int().positive().max(32).default(2),
        case_timeout_s: z.number().positive().default(180),
        outbound_trace_export: z.literal("disabled").default("disabled"),
      })
      .strict(),
    provenance: z
      .object({ sources: z.array(z.string()).default([]), notes: z.string().optional() })
      .strict()
      .default({ sources: [] }),
  })
  .strict();
export type EvalSpec = z.infer<typeof EvalSpec>;
