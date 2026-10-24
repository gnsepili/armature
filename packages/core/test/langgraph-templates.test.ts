import { parseAgentSpec } from "@armature/schema";
import { describe, expect, it } from "vitest";
import { renderWithLock } from "../src/index.ts";

const base = {
  schema_version: 1,
  name: "support-agent",
  description: "Answers order questions and issues refunds.",
  runtime: { framework: "langgraph" },
  model: { provider: "openai", id: "gpt-6.1-sol" },
  capabilities: {
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

type Spec = Record<string, unknown>;
const render = (overrides: Spec = {}, capabilities: Spec = {}) => {
  const raw = { ...base, ...overrides, capabilities: { ...base.capabilities, ...capabilities } };
  const { files, lock, plan } = renderWithLock(parseAgentSpec(raw), JSON.stringify(raw));
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const file = (path: string) => {
    const content = byPath.get(path);
    if (content === undefined) throw new Error(`${path} was not rendered`);
    return content;
  };
  return { files, lock, plan, file, paths: [...byPath.keys()] };
};
const AGENT = "src/support_agent/agent.py";

describe("langgraph templates", () => {
  it("renders the expected project layout", () => {
    const { paths } = render();
    expect(paths).toEqual(
      expect.arrayContaining([
        ".env.example",
        ".gitignore",
        "README.md",
        "pyproject.toml",
        AGENT,
        "src/support_agent/settings.py",
        "src/support_agent/runtime/server.py",
        "src/support_agent/runtime/registry.py",
        "src/support_agent/tools/lookup_order.py",
        "src/support_agent/tools/issue_refund.py",
        "src/support_agent/prompts/system.md",
        "tests/conftest.py",
        "tests/test_arc.py",
        "tests/test_tools.py",
      ]),
    );
    expect(paths.some((p) => p.includes("__pkg__") || p.includes("__tool__") || p.endsWith(".hbs"))).toBe(
      false,
    );
  });

  it("is deterministic and free of machine paths", () => {
    const a = render();
    const b = render();
    expect(a.files).toEqual(b.files);
    expect(a.lock).toEqual(b.lock);
    for (const f of a.files) {
      expect(f.content, f.path).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\|\d{4}-\d{2}-\d{2}T\d{2}:/);
    }
  });

  it("never imports an Armature runtime package", () => {
    for (const f of render().files.filter((x) => x.path.endsWith(".py"))) {
      expect(f.content, f.path).not.toMatch(/^\s*(from|import)\s+armature/m);
    }
  });

  it("keeps user code generated-once and framework code managed", () => {
    const own = Object.fromEntries(render().files.map((f) => [f.path, f.ownership]));
    expect(own[AGENT]).toBe("managed");
    expect(own["tests/test_arc.py"]).toBe("managed");
    expect(own["src/support_agent/tools/issue_refund.py"]).toBe("generated-once");
    expect(own["src/support_agent/prompts/system.md"]).toBe("generated-once");
    expect(own["README.md"]).toBe("generated-once");
  });

  it("gates write tools behind HumanInTheLoopMiddleware", () => {
    const { file } = render();
    expect(file(AGENT)).toContain("HumanInTheLoopMiddleware(interrupt_on=gated)");
    expect(file("src/support_agent/runtime/registry.py")).toMatch(/requires_approval=True/);
  });

  it("picks the checkpointer from session_memory", () => {
    const memory = render().file(AGENT);
    expect(memory).toContain("InMemorySaver()");
    expect(memory).not.toContain("AsyncSqliteSaver");

    const sqlite = render({}, { session_memory: { enabled: true, backend: "sqlite" } });
    expect(sqlite.file(AGENT)).toContain("AsyncSqliteSaver.from_conn_string(settings.session_db)");
    expect(sqlite.plan.dependencies.map((d) => d.name)).toContain("langgraph-checkpoint-sqlite");

    const off = render({}, { session_memory: { enabled: false } });
    expect(off.file(AGENT)).toContain("InMemorySaver()");
    expect(off.file("src/support_agent/settings.py")).toMatch(/"enabled": False/);
  });

  it("uses ChatAnthropic only for the anthropic provider", () => {
    const openai = render().file(AGENT);
    expect(openai).not.toContain("langchain_anthropic");
    const { file, plan } = render({ model: { provider: "anthropic", id: "claude-sonnet-5-5" } });
    expect(file(AGENT)).toContain("from langchain_anthropic import ChatAnthropic");
    // the mock model always speaks the OpenAI wire format
    expect(file(AGENT)).toContain("from langchain_openai import ChatOpenAI");
    expect(plan.dependencies.map((d) => d.name)).toEqual(
      expect.arrayContaining(["langchain-anthropic", "langchain-openai"]),
    );
  });

  it("embeds the structured output schema in settings", () => {
    const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
    const { file } = render({}, { structured_output: { enabled: true, schema } });
    expect(file("src/support_agent/settings.py")).toContain('"required": ["answer"]');
  });
});
