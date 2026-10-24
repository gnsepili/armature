import { parseAgentSpec } from "@armature/schema";
import { describe, expect, it } from "vitest";
import { renderWithLock } from "../src/index.ts";

const base = {
  schema_version: 1,
  name: "support-agent",
  runtime: { framework: "openai-agents" },
  model: { provider: "openai", id: "gpt-6.1-sol" },
  capabilities: {
    custom_tools: [
      { name: "lookup_order", side_effect: "read", args: [{ name: "order_id" }] },
      { name: "issue_refund", side_effect: "write", args: [{ name: "order_id" }] },
    ],
  },
};

type Spec = Record<string, unknown>;
const render = (overrides: Spec = {}, capabilities: Spec = {}) => {
  const raw = { ...base, ...overrides, capabilities: { ...base.capabilities, ...capabilities } };
  const { files, plan } = renderWithLock(parseAgentSpec(raw), JSON.stringify(raw));
  const agent = files.find((f) => f.path === "src/support_agent/agent.py");
  if (!agent) throw new Error("agent.py was not rendered");
  return { files, plan, agent: agent.content };
};

describe("openai-agents templates", () => {
  it("renders an Agents SDK agent and no LangGraph code", () => {
    const { files, agent, plan } = render();
    expect(agent).toContain("Runner.run_streamed(");
    expect(agent).toContain("needs_approval=t.requires_approval");
    for (const f of files.filter((x) => x.path.endsWith(".py"))) {
      expect(f.content, f.path).not.toMatch(/^\s*(from|import)\s+(langgraph|langchain|armature)/m);
    }
    const names = plan.dependencies.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(["openai-agents", "openai"]));
    expect(names.some((n) => n.startsWith("lang"))).toBe(false);
  });

  it("is deterministic", () => {
    expect(render().files).toEqual(render().files);
  });

  it("uses the Responses API for openai and Chat Completions for compatible endpoints", () => {
    expect(render().agent).toContain("return OpenAIResponsesModel(model=spec.MODEL_ID");
    const compat = render({
      model: { provider: "openai_compatible", id: "my-model", base_url: "http://localhost:8080/v1" },
    }).agent;
    expect(compat).toContain("return OpenAIChatCompletionsModel(model=spec.MODEL_ID");
    expect(compat).not.toContain("OpenAIResponsesModel(model=spec.MODEL_ID");
  });

  it("stores sessions in memory or in the sqlite file", () => {
    const memory = render().agent;
    expect(memory).toContain("session = SQLiteSession(key)\n");
    expect(memory).not.toContain("settings.session_db");
    const sqlite = render({}, { session_memory: { enabled: true, backend: "sqlite" } }).agent;
    expect(sqlite).toContain("SQLiteSession(key, self.settings.session_db)");
    expect(sqlite).toContain("Path(settings.session_db).parent.mkdir");
  });
});
