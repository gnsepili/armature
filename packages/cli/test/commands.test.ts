import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExitCode, LOCK_FILE } from "@armature/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { cli, tempDir } from "./helpers.ts";

const TOOLS = ["--tool", "lookup_order:read:order_id", "--tool", "issue_refund:write:order_id,amount"];

describe("armature init", () => {
  it("--dry-run reports the files and writes nothing", async () => {
    const cwd = tempDir();
    const r = await cli(cwd, ["init", "demo", "--yes", "--name", "demo", "--dry-run", "--json"]);
    expect(r.code).toBe(ExitCode.ok);
    const body = r.json();
    expect(body.ok).toBe(true);
    expect(body.dry_run).toBe(true);
    expect(body.files.length).toBeGreaterThan(10);
    expect(existsSync(join(cwd, "demo"))).toBe(false);
  });

  it("--yes writes the spec, the project and the lock", async () => {
    const cwd = tempDir();
    const r = await cli(cwd, ["init", "--yes", "--name", "support-bot", ...TOOLS]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    const dir = join(cwd, "support-bot");
    const spec = parse(readFileSync(join(dir, "armature.yaml"), "utf8"));
    expect(spec.name).toBe("support-bot");
    const tools = spec.capabilities.custom_tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(["lookup_order", "issue_refund"]);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
    expect(existsSync(join(dir, "src/support_bot/tools/issue_refund.py"))).toBe(true);
    expect(r.out).toContain("armature dev --offline");
  });

  it("builds the same files twice (deterministic)", async () => {
    const [a, b] = [tempDir(), tempDir()];
    for (const cwd of [a, b]) await cli(cwd, ["init", "x", "--yes", "--name", "same-agent", ...TOOLS]);
    // The lock holds a hash of every managed file.
    expect(readFileSync(join(a, "x", LOCK_FILE), "utf8")).toBe(readFileSync(join(b, "x", LOCK_FILE), "utf8"));
  });

  it("refuses to replace an existing armature.yaml (exit 3)", async () => {
    const cwd = tempDir();
    await cli(cwd, ["init", "p", "--yes", "--name", "first"]);
    const r = await cli(cwd, ["init", "p", "--yes", "--name", "second"]);
    expect(r.code).toBe(ExitCode.overwriteRefused);
    expect(r.err).toContain("--force");
  });

  it("rejects an invalid config with exit 1 and names the field", async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "bad.yaml"), "name: Not A Slug\n");
    const r = await cli(cwd, ["init", "out", "--config", "bad.yaml", "--json"]);
    expect(r.code).toBe(ExitCode.validation);
    const body = r.json();
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).toContain("name");
  });

  it("reads a config from stdin", async () => {
    const cwd = tempDir();
    const r = await cli(cwd, ["init", "--config", "-", "--yes", "--json"], "name: from-stdin\n");
    expect(r.code, r.err).toBe(ExitCode.ok);
    expect(existsSync(join(cwd, "from-stdin", "armature.yaml"))).toBe(true);
  });

  it("reports a planned framework or pattern as unsupported (exit 2)", async () => {
    const cwd = tempDir();
    const fw = await cli(cwd, ["init", "a", "--yes", "--framework", "crewai"]);
    expect(fw.code).toBe(ExitCode.unsupported);
    expect(fw.err).toContain("supported: langgraph, openai-agents");
    const pattern = await cli(cwd, ["init", "b", "--yes", "--pattern", "supervisor"]);
    expect(pattern.code).toBe(ExitCode.unsupported);
  });

  it("rejects bad flag values with exit 1", async () => {
    const cwd = tempDir();
    expect((await cli(cwd, ["init", "a", "--yes", "--tool", "x:explode"])).code).toBe(ExitCode.validation);
    expect((await cli(cwd, ["init", "a", "--yes", "--with", "telepathy"])).code).toBe(ExitCode.validation);
    expect((await cli(cwd, ["init", "a", "--yes", "--frobnicate"])).code).toBe(ExitCode.validation);
  });

  it("needs --experimental for a model outside the catalog", async () => {
    const cwd = tempDir();
    const flags = ["--yes", "--provider", "openai", "--model", "gpt-unknown-9"];
    expect((await cli(cwd, ["init", "a", ...flags])).code).toBe(ExitCode.unsupported);
    expect((await cli(cwd, ["init", "b", ...flags, "--experimental"])).code).toBe(ExitCode.ok);
  });
});

describe("armature generate and plan", () => {
  async function project() {
    const cwd = tempDir();
    await cli(cwd, ["init", "p", "--yes", "--name", "gen-test", ...TOOLS]);
    return join(cwd, "p");
  }

  it("is a no-op on an unchanged project", async () => {
    const dir = await project();
    const r = await cli(dir, ["generate", "--json"]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    const counts = r.json().counts;
    expect(Object.keys(counts)).toEqual(["unchanged"]);
  });

  it("keeps a managed file the user edited, and --force replaces it", async () => {
    const dir = await project();
    const file = join(dir, "src/gen_test/agent.py");
    writeFileSync(file, "# mine\n");
    const kept = await cli(dir, ["generate", "--json"]);
    expect(kept.code).toBe(ExitCode.ok);
    expect(kept.json().counts["skip-modified"]).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("# mine\n");
    await cli(dir, ["generate", "--force"]);
    expect(readFileSync(file, "utf8")).not.toBe("# mine\n");
  });

  it("never touches tool implementations", async () => {
    const dir = await project();
    const tool = join(dir, "src/gen_test/tools/lookup_order.py");
    writeFileSync(tool, "def lookup_order(order_id):\n    return {'id': order_id}\n");
    await cli(dir, ["generate", "--force"]);
    expect(readFileSync(tool, "utf8")).toContain("return {'id': order_id}");
  });

  it("plan --json explains the build and changes nothing", async () => {
    const dir = await project();
    const spec = join(dir, "armature.yaml");
    writeFileSync(spec, `${readFileSync(spec, "utf8")}policies:\n  limits:\n    max_steps: 9\n`);
    const before = readFileSync(join(dir, "src/gen_test/settings.py"), "utf8");
    const r = await cli(dir, ["plan", "--json"]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    const body = r.json();
    expect(body.mode).toBe("update");
    expect(body.plan.limits.max_steps).toBe(9);
    expect(body.secrets).toEqual(["OPENAI_API_KEY"]);
    expect(body.tasks).toHaveLength(2);
    expect(body.files.some((f: { action: string }) => f.action === "update")).toBe(true);
    expect(readFileSync(join(dir, "src/gen_test/settings.py"), "utf8")).toBe(before);
  });

  it("fails with exit 1 when there is no spec", async () => {
    const r = await cli(tempDir(), ["generate"]);
    expect(r.code).toBe(ExitCode.validation);
  });
});

describe("armature --help", () => {
  it("prints help and the version with exit 0", async () => {
    const cwd = tempDir();
    const help = await cli(cwd, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("init");
    const version = await cli(cwd, ["--version"]);
    expect(version.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
