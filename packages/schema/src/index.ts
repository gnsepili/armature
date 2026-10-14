import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { AgentSpec } from "./agent-spec.ts";
import { EvalCase, EvalSpec, ReferenceTrajectory } from "./eval.ts";

export * from "./agent-spec.ts";
export * from "./eval.ts";

export interface SchemaIssue {
  path: string;
  message: string;
}

export class SchemaError extends Error {
  constructor(
    readonly source: string,
    readonly issues: SchemaIssue[],
  ) {
    super(
      `${source} is invalid:\n${issues.map((i) => `  - ${i.path || "(root)"}: ${i.message}`).join("\n")}`,
    );
    this.name = "SchemaError";
  }
}

function formatIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function parseWith<T extends z.ZodType>(schema: T, value: unknown, source: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new SchemaError(source, formatIssues(result.error));
  return result.data;
}

export function parseYamlText(text: string, source: string): unknown {
  try {
    return parseYaml(text, { prettyErrors: true });
  } catch (err) {
    throw new SchemaError(source, [{ path: "", message: `not valid YAML: ${(err as Error).message}` }]);
  }
}

export const parseAgentSpec = (value: unknown, source = "armature.yaml") =>
  parseWith(AgentSpec, value, source);
export const parseEvalSpec = (value: unknown, source = "evals/evalspec.yaml") =>
  parseWith(EvalSpec, value, source);
export const parseEvalCase = (value: unknown, source = "eval case") => parseWith(EvalCase, value, source);
export const parseReference = (value: unknown, source = "reference trajectory") =>
  parseWith(ReferenceTrajectory, value, source);

/** JSON Schemas published for editors and external tooling. */
export function jsonSchemas(): Record<string, unknown> {
  const opts = { io: "input" as const, unrepresentable: "any" as const };
  return {
    "armature.schema.json": z.toJSONSchema(AgentSpec, opts),
    "evalspec.schema.json": z.toJSONSchema(EvalSpec, opts),
    "eval-case.schema.json": z.toJSONSchema(EvalCase, opts),
    "reference.schema.json": z.toJSONSchema(ReferenceTrajectory, opts),
  };
}
