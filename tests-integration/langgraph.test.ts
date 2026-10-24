import { beforeAll, describe, expect, it } from "vitest";
import { conformance, generateProject, hasUv, install, pytest, summary } from "./harness.ts";

const spec = {
  schema_version: 1,
  name: "lg-support",
  description: "Looks up orders and issues refunds.",
  runtime: { framework: "langgraph" },
  model: { provider: "openai", id: "gpt-6.1-sol" },
  capabilities: {
    session_memory: { enabled: true, backend: "sqlite" },
    custom_tools: [
      { name: "lookup_order", side_effect: "read", args: [{ name: "order_id" }] },
      {
        name: "issue_refund",
        side_effect: "write",
        args: [{ name: "order_id" }, { name: "amount", type: "number" }],
      },
    ],
  },
};

describe.skipIf(!hasUv())("langgraph project", () => {
  let dir = "";
  beforeAll(() => {
    dir = generateProject("langgraph", spec);
    install(dir);
  });

  it("passes its own generated tests", () => {
    const { ok, output } = pytest(dir);
    expect(ok, output).toBe(true);
  });

  it("passes ARC conformance", async () => {
    const { report, logs } = await conformance(dir, "lg_support");
    expect(report.passed, `${summary(report)}\n\n${logs}`).toBe(true);
  });
});
