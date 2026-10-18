import { parseAgentSpec } from "@armature/schema";
import { describe, expect, it } from "vitest";
import { planDependencies, planProject } from "../src/plan.ts";

const base = {
  schema_version: 1,
  name: "support-agent",
  runtime: { framework: "langgraph" },
  model: { provider: "openai", id: "gpt-6.1-sol" },
};

describe("planProject", () => {
  it("adds example tools when none are declared", () => {
    const plan = planProject(parseAgentSpec(base));
    expect(plan.package).toBe("support_agent");
    expect(plan.tools.map((t) => [t.name, t.requires_approval, t.example])).toEqual([
      ["lookup_item", false, true],
      ["save_note", true, true],
    ]);
    expect(plan.model).toMatchObject({ known: true, price_input: 2, api_key_env: "OPENAI_API_KEY" });
  });

  it("derives schemas, approvals and retries from declared tools", () => {
    const plan = planProject(
      parseAgentSpec({
        ...base,
        policies: { approvals: { write: "allow" } },
        capabilities: {
          custom_tools: [
            {
              name: "issue_refund",
              side_effect: "write",
              args: [
                { name: "order_id" },
                { name: "amount", type: "number", required: false, description: "USD" },
              ],
            },
            { name: "close_account", side_effect: "destructive" },
          ],
        },
      }),
    );
    const [refund, close] = plan.tools;
    expect(refund).toMatchObject({ class_name: "IssueRefund", requires_approval: false, idempotent: false });
    expect(refund?.input_schema).toEqual({
      type: "object",
      properties: { order_id: { type: "string" }, amount: { type: "number", description: "USD" } },
      required: ["order_id"],
      additionalProperties: false,
    });
    expect(refund?.args[1]?.py_type).toBe("float");
    expect(close?.requires_approval).toBe(true);
    expect(plan.has_approval_tools).toBe(true);
  });

  it("pins provider and session backend packages", () => {
    const names = (s: object) => planDependencies(parseAgentSpec({ ...base, ...s })).map((d) => d.name);
    expect(names({})).not.toContain("langgraph-checkpoint-sqlite");
    expect(names({ capabilities: { session_memory: { backend: "sqlite" } } })).toContain(
      "langgraph-checkpoint-sqlite",
    );
    expect(names({ capabilities: { session_memory: { enabled: false } } })).not.toContain(
      "langgraph-checkpoint-sqlite",
    );
    expect(names({ model: { provider: "anthropic", id: "claude-sonnet-5-5" } })).toContain(
      "langchain-anthropic",
    );
    const agents = names({ runtime: { framework: "openai-agents" } });
    expect(agents).toContain("openai-agents");
    expect(agents).not.toContain("langgraph");
    expect(agents).toEqual([...agents].sort());
  });

  it("keeps unknown model prices null instead of guessing", () => {
    const plan = planProject(
      parseAgentSpec({ ...base, model: { provider: "openai", id: "gpt-unreleased" } }),
    );
    expect(plan.model).toMatchObject({ known: false, price_input: null, price_output: null });
  });
});
