import { parseAgentSpec } from "@armature/schema";
import { describe, expect, it } from "vitest";
import { checkCompatibility } from "../src/compat.ts";

const spec = (over: Record<string, unknown> = {}) =>
  parseAgentSpec({
    schema_version: 1,
    name: "support-agent",
    runtime: { framework: "langgraph" },
    model: { provider: "openai", id: "gpt-6.1-sol" },
    ...over,
  });

const codes = (s: ReturnType<typeof spec>) => checkCompatibility(s).findings.map((f) => f.code);

describe("checkCompatibility", () => {
  it("supports the default LangGraph + OpenAI spec", () => {
    expect(checkCompatibility(spec())).toEqual({ status: "supported", findings: [] });
  });

  it("rejects Anthropic models on the Agents SDK with a hint", () => {
    const report = checkCompatibility(
      spec({
        runtime: { framework: "openai-agents" },
        model: { provider: "anthropic", id: "claude-sonnet-5-5" },
      }),
    );
    expect(report.status).toBe("unsupported");
    expect(report.findings[0]?.message).toMatch(/use langgraph/);
  });

  it("allows Anthropic models on LangGraph", () => {
    expect(
      checkCompatibility(spec({ model: { provider: "anthropic", id: "claude-sonnet-5-5" } })).status,
    ).toBe("supported");
  });

  it("marks unknown models experimental", () => {
    const report = checkCompatibility(spec({ model: { provider: "openai", id: "gpt-unreleased" } }));
    expect(report.status).toBe("experimental");
    expect(report.findings[0]?.code).toBe("unknown_model");
  });

  it("marks OpenAI-compatible endpoints experimental", () => {
    const s = spec({
      model: { provider: "openai_compatible", id: "llama", base_url: "http://localhost:11434/v1" },
    });
    expect(checkCompatibility(s).status).toBe("experimental");
  });

  it("rejects planned features", () => {
    expect(codes(spec({ capabilities: { rag: { enabled: true } } }))).toContain("rag");
    expect(codes(spec({ interfaces: ["sse", "websocket"] }))).toContain("websocket");
    expect(codes(spec({ runtime: { framework: "crewai" } }))).toContain("framework");
  });

  it("rejects package names that shadow imports", () => {
    const report = checkCompatibility(spec({ name: "langgraph" }));
    expect(report.status).toBe("unsupported");
    expect(report.findings[0]?.message).toMatch(/langgraph-app/);
  });

  it("rejects Python keywords and duplicate arguments", () => {
    const s = spec({
      capabilities: {
        custom_tools: [
          { name: "lookup", args: [{ name: "from" }, { name: "id" }, { name: "id" }] },
          { name: "match", args: [{ name: "type" }] },
        ],
      },
    });
    const report = checkCompatibility(s);
    expect(report.findings.filter((f) => f.code === "arg_name")).toHaveLength(2);
    expect(report.findings.some((f) => f.code === "tool_name")).toBe(false);
  });

  it("notes idempotent write tools", () => {
    const s = spec({
      capabilities: { custom_tools: [{ name: "upsert", side_effect: "write", idempotent: true }] },
    });
    expect(checkCompatibility(s)).toMatchObject({
      status: "supported",
      findings: [{ code: "idempotent_write" }],
    });
  });
});
