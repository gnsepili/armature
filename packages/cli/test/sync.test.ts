import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExitCode, LOCK_FILE } from "@armature/core";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { cli, tempDir } from "./helpers.ts";

async function project(targets = ["--assistant", "claude", "--assistant", "codex"]) {
  const cwd = tempDir();
  const r = await cli(cwd, [
    "init",
    "--yes",
    "--name",
    "demo",
    "--tool",
    "lookup_order:read:order_id",
    ...targets,
  ]);
  expect(r.code, r.err).toBe(ExitCode.ok);
  return join(cwd, "demo");
}

const read = (dir: string, p: string) => readFileSync(join(dir, p), "utf8");
const lock = (dir: string) => JSON.parse(read(dir, LOCK_FILE));

describe("armature sync", () => {
  it("is a no-op on a fresh project", async () => {
    const dir = await project();
    const r = await cli(dir, ["sync", "--json"]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    const body = r.json();
    expect(body.command).toBe("sync");
    expect(body.files.every((f: { action: string }) => f.action === "unchanged")).toBe(true);
    expect(body.files.every((f: { path: string }) => !f.path.startsWith("src/"))).toBe(true);
  });

  it("copies an edited canonical skill and a user-created skill into .claude/skills", async () => {
    const dir = await project();
    const skill = ".agents/skills/add-tool/SKILL.md";
    writeFileSync(join(dir, skill), `${read(dir, skill)}\n- House rule: tools log their latency.\n`);
    mkdirSync(join(dir, ".agents/skills/house-style"), { recursive: true });
    const mine = "---\nname: house-style\ndescription: Our conventions. Use always.\n---\n\nBe brief.\n";
    writeFileSync(join(dir, ".agents/skills/house-style/SKILL.md"), mine);

    const r = await cli(dir, ["sync"]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    expect(read(dir, ".claude/skills/add-tool/SKILL.md")).toContain("House rule");
    expect(read(dir, skill)).toContain("House rule"); // the user's edit is kept
    expect(read(dir, ".claude/skills/house-style/SKILL.md")).toBe(mine);
  });

  it("refreshes handoff files only and keeps the runtime's lock entries", async () => {
    const dir = await project();
    const before = lock(dir);
    const spec = parse(read(dir, "armature.yaml"));
    spec.capabilities.custom_tools.push({
      name: "track_parcel",
      side_effect: "read",
      args: [{ name: "parcel_id" }],
    });
    writeFileSync(join(dir, "armature.yaml"), stringify(spec));

    const r = await cli(dir, ["sync", "--json"]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    const changed = r.json().files.filter((f: { action: string }) => f.action !== "unchanged");
    expect(changed.length).toBeGreaterThan(0);
    for (const f of changed)
      expect(f.path).toMatch(/^(AGENTS\.md|CLAUDE\.md|docs\/|\.agents\/|\.claude\/|\.mcp\.json|\.codex\/)/);

    const after = lock(dir);
    expect(after.spec_sha256).toBe(before.spec_sha256);
    expect(after.dependencies).toEqual(before.dependencies);
    for (const [path, entry] of Object.entries(before.files))
      if (path.startsWith("src/")) expect(after.files[path]).toEqual(entry);
    expect(Object.keys(after.files).some((p) => p.includes("track_parcel"))).toBe(false);

    const g = await cli(dir, ["generate", "--json"]);
    expect(g.code, g.err).toBe(ExitCode.ok);
    expect(
      g
        .json()
        .files.some(
          (f: { path: string; action: string }) => f.path.includes("track_parcel") && f.action === "create",
        ),
    ).toBe(true);
  });

  it("adds Claude files when the claude target is added later", async () => {
    const dir = await project(["--assistant", "codex"]);
    const spec = parse(read(dir, "armature.yaml"));
    spec.assistant.targets = ["codex", "claude"];
    writeFileSync(join(dir, "armature.yaml"), stringify(spec));
    const r = await cli(dir, ["sync"]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    expect(read(dir, "CLAUDE.md")).toMatch(/^@AGENTS\.md/);
    expect(read(dir, ".claude/skills/build-agent/SKILL.md")).toBe(
      read(dir, ".agents/skills/build-agent/SKILL.md"),
    );
  });

  it("fails without armature.lock", async () => {
    const dir = await project();
    rmSync(join(dir, LOCK_FILE));
    const r = await cli(dir, ["sync", "--json"]);
    expect(r.code).toBe(ExitCode.validation);
    expect(r.json().error.message).toMatch(/no armature\.lock/);
  });
});
