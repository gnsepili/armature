import { validateSkills } from "@armature/handoff";
import { parseAgentSpec } from "@armature/schema";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index.ts";

type Spec = Record<string, unknown>;
const spec = (framework: string, extra: Spec = {}) =>
  parseAgentSpec({
    schema_version: 1,
    name: "order-helper",
    runtime: { framework },
    model: { provider: "openai", id: "gpt-6.1-sol" },
    capabilities: {
      custom_tools: [
        { name: "lookup_order", side_effect: "read", args: [{ name: "order_id" }] },
        { name: "cancel_order", side_effect: "destructive", args: [{ name: "order_id" }] },
      ],
    },
    ...extra,
  });

const filesOf = (framework: string, extra: Spec = {}) => {
  const files = compile(spec(framework, extra)).files;
  const byPath = new Map(files.map((f) => [f.path, f]));
  return { files, paths: [...byPath.keys()], get: (p: string) => byPath.get(p)?.content };
};

const SKILLS = ["add-tool", "build-agent", "build-benchmark", "debug-run", "optimize-agent"];
const DOCS = ["AGENT_SPEC", "ARCHITECTURE", "BUILD_STATUS", "IMPLEMENTATION_PLAN", "TOOL_CONTRACTS"];

describe.each(["langgraph", "openai-agents"])("handoff kit (%s)", (framework) => {
  const other = framework === "langgraph" ? "openai-agents" : "langgraph";

  it("renders instructions, docs and every skill", () => {
    const { paths } = filesOf(framework);
    expect(paths).toContain("AGENTS.md");
    for (const d of DOCS) expect(paths).toContain(`docs/${d}.md`);
    for (const s of SKILLS) {
      expect(paths).toContain(`.agents/skills/${s}/SKILL.md`);
      expect(paths).toContain(`.claude/skills/${s}/SKILL.md`);
    }
  });

  it("produces skills that pass the Agent Skills frontmatter rules", () => {
    expect(validateSkills(filesOf(framework).files)).toEqual([]);
  });

  it("includes only this framework's references", () => {
    const { paths } = filesOf(framework);
    for (const s of ["add-tool", "debug-run"]) {
      expect(paths).toContain(`.agents/skills/${s}/references/${framework}.md`);
      expect(paths).not.toContain(`.agents/skills/${s}/references/${other}.md`);
    }
  });

  it("leaves no unrendered template syntax or triple blank lines", () => {
    for (const f of filesOf(framework).files.filter((f) => f.path.endsWith(".md"))) {
      expect(f.content, f.path).not.toMatch(/\{\{|\}\}/);
      expect(f.content, f.path).not.toMatch(/\n\n\n\n/);
    }
  });

  it("points a fresh session at the plan and the skills", () => {
    const agents = filesOf(framework).get("AGENTS.md") ?? "";
    expect(agents).toContain("docs/IMPLEMENTATION_PLAN.md");
    expect(agents).toContain(".agents/skills");
    const plan = filesOf(framework).get("docs/IMPLEMENTATION_PLAN.md") ?? "";
    expect(plan).toContain("implement `lookup_order`");
    expect(plan).toContain("implement `cancel_order`");
  });
});

describe("assistant targets", () => {
  it("claude only: CLAUDE.md, .claude/skills and .mcp.json, no Codex config", () => {
    const { paths, get } = filesOf("langgraph", { assistant: { targets: ["claude"] } });
    expect(paths).toContain("CLAUDE.md");
    expect(paths).not.toContain(".codex/config.toml");
    expect(get("CLAUDE.md")).toMatch(/^@AGENTS\.md/);
    expect(JSON.parse(get(".mcp.json") ?? "{}")).toEqual({
      mcpServers: { "langchain-docs": { type: "http", url: "https://docs.langchain.com/mcp" } },
    });
  });

  it("codex only: Codex docs server, no Claude files", () => {
    const { paths, get } = filesOf("openai-agents", { assistant: { targets: ["codex"] } });
    expect(paths).not.toContain("CLAUDE.md");
    expect(paths).not.toContain(".mcp.json");
    expect(paths.some((p) => p.startsWith(".claude/"))).toBe(false);
    expect(get(".codex/config.toml")).toContain('url = "https://developers.openai.com/mcp"');
  });

  it("docs_mcp off: no MCP configs at all", () => {
    const { paths } = filesOf("langgraph", { assistant: { targets: ["claude", "codex"], docs_mcp: false } });
    expect(paths).not.toContain(".mcp.json");
    expect(paths).not.toContain(".codex/config.toml");
  });

  it("is deterministic", () => {
    expect(filesOf("langgraph").files).toEqual(filesOf("langgraph").files);
  });
});
