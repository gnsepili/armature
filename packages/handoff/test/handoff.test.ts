import { describe, expect, it } from "vitest";
import { frontmatter, isHandoffPath, validateSkill, withSkillCopies } from "../src/index.ts";

const skill = (name: string, description = "Does a thing. Use when needed.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# Body\n`;

describe("frontmatter", () => {
  it("reads top-level scalars and strips quotes", () => {
    expect(frontmatter('---\nname: "a-b"\ndescription: x: y\n---\nbody')).toEqual({
      name: "a-b",
      description: "x: y",
    });
  });

  it("returns null without frontmatter", () => {
    expect(frontmatter("# just markdown\n")).toBeNull();
  });
});

describe("validateSkill", () => {
  it("accepts a valid skill", () => {
    expect(validateSkill(".agents/skills/add-tool/SKILL.md", skill("add-tool"))).toEqual([]);
  });

  it.each(["Add-Tool", "add--tool", "-add", "add_tool", "a".repeat(65)])("rejects name %s", (name) => {
    const issues = validateSkill(`.agents/skills/${name}/SKILL.md`, skill(name));
    expect(issues.map((i) => i.message).join()).toMatch(/lowercase letters/);
  });

  it("requires the name to match the directory", () => {
    const issues = validateSkill(".agents/skills/other/SKILL.md", skill("add-tool"));
    expect(issues[0]?.message).toMatch(/does not match its directory "other"/);
  });

  it("checks the description length", () => {
    expect(validateSkill(".agents/skills/x/SKILL.md", skill("x", "")).at(0)?.message).toMatch(
      /no description/,
    );
    expect(validateSkill(".agents/skills/x/SKILL.md", skill("x", "d".repeat(1025))).at(0)?.message).toMatch(
      /1025 characters/,
    );
  });

  it("reports missing frontmatter", () => {
    expect(validateSkill(".agents/skills/x/SKILL.md", "# x")).toHaveLength(1);
  });
});

describe("isHandoffPath", () => {
  it("covers instructions, docs, skills and MCP config only", () => {
    for (const p of ["AGENTS.md", "CLAUDE.md", ".mcp.json", ".codex/config.toml", "docs/a.md"])
      expect(isHandoffPath(p)).toBe(true);
    expect(isHandoffPath(".agents/skills/a/SKILL.md")).toBe(true);
    expect(isHandoffPath(".claude/skills/a/SKILL.md")).toBe(true);
    for (const p of ["README.md", "src/pkg/agent.py", "armature.yaml", ".claude/settings.json"])
      expect(isHandoffPath(p)).toBe(false);
  });
});

describe("withSkillCopies", () => {
  const files = [
    { path: "AGENTS.md", content: "a", ownership: "managed" as const },
    { path: ".agents/skills/x/SKILL.md", content: skill("x"), ownership: "managed" as const },
  ];

  it("adds managed .claude copies for the claude target", () => {
    const out = withSkillCopies(files, { targets: ["claude"] });
    const copy = out.find((f) => f.path === ".claude/skills/x/SKILL.md");
    expect(copy).toEqual({ path: ".claude/skills/x/SKILL.md", content: skill("x"), ownership: "managed" });
    expect(out.map((f) => f.path)).toEqual([...out.map((f) => f.path)].sort());
  });

  it("does nothing without the claude target", () => {
    expect(withSkillCopies(files, { targets: ["codex"] })).toBe(files);
  });
});
