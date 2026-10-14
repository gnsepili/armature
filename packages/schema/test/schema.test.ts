import { describe, expect, it } from "vitest";
import { jsonSchemas, parseAgentSpec, parseEvalCase, SchemaError } from "../src/index.ts";

const minimal = {
  schema_version: 1,
  name: "support-agent",
  runtime: { framework: "langgraph" },
  model: { provider: "openai", id: "gpt-test" },
};

describe("AgentSpec", () => {
  it("fills defaults for a minimal spec", () => {
    const spec = parseAgentSpec(minimal);
    expect(spec.runtime.pattern).toBe("single_agent_tools");
    expect(spec.policies.limits.max_steps).toBe(15);
    expect(spec.policies.approvals.write).toBe("require");
    expect(spec.capabilities.session_memory.enabled).toBe(true);
    expect(spec.interfaces).toContain("sse");
  });

  it("rejects unknown keys and bad names with paths", () => {
    try {
      parseAgentSpec({ ...minimal, name: "Bad Name", surprise: true });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaError);
      const paths = (err as SchemaError).issues.map((i) => i.path);
      expect(paths).toContain("name");
    }
  });

  it("rejects duplicate tool names", () => {
    expect(() =>
      parseAgentSpec({
        ...minimal,
        capabilities: { custom_tools: [{ name: "lookup" }, { name: "lookup" }] },
      }),
    ).toThrow(/duplicate tool name/);
  });

  it("requires base_url for openai_compatible", () => {
    expect(() => parseAgentSpec({ ...minimal, model: { provider: "openai_compatible", id: "x" } })).toThrow(
      /base_url/,
    );
  });
});

describe("EvalCase", () => {
  it("parses the PRD example shape", () => {
    const c = parseEvalCase({
      id: "refund-damaged-item",
      suite: "dev",
      category: "happy_path",
      origin: "generated",
      trust: "VERIFIED",
      input: "Order 1234 arrived broken.",
      graders: [
        {
          type: "constraint",
          never_call: ["delete_account"],
          approval_before: ["create_refund"],
          max_steps: 8,
        },
        { type: "output", contains_any: ["refund"] },
        { type: "judge", rubric: "scorers/rubrics/tone.v1.md", weight: 0.3 },
      ],
      trials: 3,
    });
    expect(c.pass).toBe("all");
    expect(c.graders).toHaveLength(3);
  });
});

describe("jsonSchemas", () => {
  it("exports four schemas", () => {
    expect(Object.keys(jsonSchemas())).toHaveLength(4);
  });
});
