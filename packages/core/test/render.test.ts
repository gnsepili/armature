import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseAgentSpec } from "@armature/schema";
import { describe, expect, it } from "vitest";
import { planProject } from "../src/plan.ts";
import { globToRegExp, pyLiteral, renderProject } from "../src/render.ts";

function layer(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "armature-layer-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const plan = planProject(
  parseAgentSpec({
    schema_version: 1,
    name: "demo-agent",
    runtime: { framework: "langgraph" },
    model: { provider: "openai", id: "gpt-6.1-sol" },
  }),
);

describe("pyLiteral", () => {
  it("renders JSON values as Python literals", () => {
    expect(pyLiteral({ a: [true, null, 1.5, 'x"y'], b: false })).toBe(
      '{"a": [True, None, 1.5, "x\\"y"], "b": False}',
    );
  });
});

describe("globToRegExp", () => {
  it("handles single and double stars", () => {
    expect(globToRegExp("src/*/tools/*.py").test("src/pkg/tools/a.py")).toBe(true);
    expect(globToRegExp("src/*/tools/*.py").test("src/pkg/tools/x/a.py")).toBe(false);
    expect(globToRegExp("prompts/**").test("prompts/a/b.md")).toBe(true);
    expect(globToRegExp("**/README.md").test("README.md")).toBe(true);
  });
});

describe("renderProject", () => {
  it("maps paths, expands per-tool templates and applies ownership", () => {
    const common = layer({
      "ownership.json": JSON.stringify({ "generated-once": ["src/*/tools/*.py", "README.md"] }),
      "README.md.hbs": "# {{name}}\n",
      dot_gitignore: ".venv/\n",
      "src/__pkg__/tools/__tool__.py.hbs": "NAME = {{py tool.name}}\nSIDE = {{py tool.side_effect}}\n",
      "src/__pkg__/empty.py.hbs": "{{#if false}}x{{/if}}\n",
      "raw.txt": "{{not rendered}}",
    });
    const files = renderProject(plan, [common]);
    expect(files.map((f) => [f.path, f.ownership])).toEqual([
      [".gitignore", "managed"],
      ["README.md", "generated-once"],
      ["raw.txt", "managed"],
      ["src/demo_agent/tools/lookup_item.py", "generated-once"],
      ["src/demo_agent/tools/save_note.py", "generated-once"],
    ]);
    expect(files.find((f) => f.path.endsWith("save_note.py"))?.content).toBe(
      'NAME = "save_note"\nSIDE = "write"\n',
    );
    expect(files.find((f) => f.path === "raw.txt")?.content).toBe("{{not rendered}}\n");
  });

  it("lets later layers override earlier ones", () => {
    const a = layer({ "agent.py.hbs": "a\r\n\r\n" });
    const b = layer({ "agent.py.hbs": "b" });
    expect(renderProject(plan, [a, b])).toEqual([{ path: "agent.py", content: "b\n", ownership: "managed" }]);
    expect(renderProject(plan, [a])[0]?.content).toBe("a\n");
  });

  it("fails on unknown template fields", () => {
    expect(() => renderProject(plan, [layer({ "x.hbs": "{{nope}}" })])).toThrow(/nope/);
  });
});
