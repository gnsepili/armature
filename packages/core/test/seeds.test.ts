import { EvalCase, EvalSpec, parseAgentSpec, ReferenceTrajectory } from "@armature/schema";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { planProject } from "../src/plan.ts";
import { seedEvalFiles, slug } from "../src/seeds.ts";

const spec = {
  schema_version: 1,
  name: "order-helper",
  runtime: { framework: "langgraph" },
  model: { provider: "openai", id: "gpt-6.1-sol" },
  capabilities: {
    custom_tools: [
      { name: "lookup_order", side_effect: "read", args: [{ name: "order_id" }] },
      { name: "refund_order", side_effect: "write", args: [{ name: "order_id" }] },
    ],
  },
  intent: {
    problem: "Customers ask about orders.",
    examples: [
      { request: "Where is my order 1234?", desired_outcome: "The order status." },
      { request: "Where is my order 1234?" },
    ],
    prohibited_actions: ["Refund an order that was never delivered."],
  },
};

const seeded = () => seedEvalFiles(planProject(parseAgentSpec(spec)));

describe("seedEvalFiles", () => {
  it("writes a valid evalspec and cases that parse against the schemas", () => {
    const files = seeded();
    for (const f of files) expect(f.ownership).toBe("generated-once");
    const evalspec = files.find((f) => f.path === "evals/evalspec.yaml")!;
    const parsed = EvalSpec.parse(parse(evalspec.content));
    expect(parsed.suites.heldout).toMatchObject({ report: "aggregate_only", trials: 3 });
    expect(parsed.suites.smoke!.mode).toBe("offline");

    const cases = files
      .filter((f) => f.path.startsWith("evals/cases/"))
      .map((f) => EvalCase.parse(parse(f.content)));
    const refs = files
      .filter((f) => f.path.startsWith("evals/fixtures/"))
      .map((f) => ReferenceTrajectory.parse(parse(f.content)));
    expect(cases.map((c) => c.id)).toEqual([
      "smoke-contract",
      "smoke-approval",
      "happy-where-is-my-order-1234",
      "happy-where-is-my-order-1234-2",
      "ambiguous-request",
      "injection-reveal-instructions",
      "prohibited-refund-an-order-that-was-never-delivered",
    ]);
    for (const c of cases) {
      expect(c.trust).toBe("DRAFT_UNVERIFIED");
      expect(c.origin).toBe("seed");
      if (c.suite === "dev") expect(refs.map((r) => r.case)).toContain(c.id);
    }
    // At least three dev seeds, as the PRD requires.
    expect(cases.filter((c) => c.suite === "dev").length).toBeGreaterThanOrEqual(3);
  });

  it("marks prohibited and adversarial seeds critical and keeps write tools out of them", () => {
    const cases = seeded()
      .filter((f) => f.path.startsWith("evals/cases/dev/"))
      .map((f) => EvalCase.parse(parse(f.content)));
    for (const c of cases.filter((c) => c.category === "prohibited_action" || c.category === "adversarial")) {
      expect(c.severity).toBe("critical");
      expect(c.graders).toContainEqual(
        expect.objectContaining({ type: "constraint", never_call: ["refund_order"] }),
      );
    }
  });

  it("is deterministic", () => {
    expect(seeded()).toEqual(seeded());
  });

  it("slugs requests into case ids", () => {
    expect(slug("Where is my order #1234?")).toBe("where-is-my-order-1234");
    expect(slug("a".repeat(60)).length).toBeLessThanOrEqual(48);
  });
});
