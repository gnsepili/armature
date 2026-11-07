import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { ExitCode } from "@armature/core";
import { beforeAll, describe, expect, it } from "vitest";
import { cli, tempDir } from "./helpers.ts";

// Neither command gets a virtualenv here; the integration suite runs them against real installs.
let dir: string;
beforeAll(async () => {
  const cwd = tempDir();
  const r = await cli(cwd, ["init", "--yes", "--name", "demo", "--tool", "lookup_order:read:order_id"]);
  expect(r.code, r.err).toBe(ExitCode.ok);
  dir = join(cwd, "demo");
});

type Check = { name: string; status: string; exit_code?: number };
const byName = (checks: Check[], name: string) => checks.find((c) => c.name === name);

describe("armature doctor", () => {
  it("passes the spec and scaffold checks and fails on the missing virtualenv", async () => {
    const r = await cli(dir, ["doctor", "--json"]);
    expect(r.code).toBe(ExitCode.environment);
    const body = r.json();
    expect(body.ok).toBe(false);
    expect(byName(body.checks, "spec")?.status).toBe("ok");
    expect(byName(body.checks, "scaffold")?.status).toBe("ok");
    expect(byName(body.checks, "venv")).toMatchObject({ status: "fail", exit_code: ExitCode.environment });
  });

  it("skips the probe when an earlier check failed", async () => {
    const r = await cli(dir, ["doctor", "--probe", "--json"]);
    expect(r.code).toBe(ExitCode.environment);
    expect(byName(r.json().checks, "probe")?.status).toBe("skip");
  });

  it("fails the spec check outside a project", async () => {
    const r = await cli(tempDir(), ["doctor", "--json"]);
    expect(r.code).not.toBe(ExitCode.ok);
    expect(byName(r.json().checks, "spec")?.status).toBe("fail");
  });
});

describe("armature test", () => {
  it("--only golden passes right after init", async () => {
    const r = await cli(dir, ["test", "--only", "golden", "--json"]);
    expect(r.code, r.out).toBe(ExitCode.ok);
    const body = r.json();
    expect(body.parts.map((p: { part: string }) => p.part)).toEqual(["golden"]);
    expect(body.parts[0].passed).toBe(true);
  });

  it("--only golden reports an edited managed file", async () => {
    const cwd = tempDir();
    await cli(cwd, ["init", "--yes", "--name", "edited", "--tool", "lookup_order:read:order_id"]);
    const project = join(cwd, "edited");
    appendFileSync(join(project, "src/edited/agent.py"), "\n# local tweak\n");
    const r = await cli(project, ["test", "--only", "golden", "--json"]);
    expect(r.code).toBe(ExitCode.validation);
    expect(r.json().parts[0].details.join("\n")).toContain("src/edited/agent.py");
  });

  it("exits 5 when the unit part has no virtualenv", async () => {
    const r = await cli(dir, ["test", "--only", "unit", "--json"]);
    expect(r.code).toBe(ExitCode.environment);
    expect(r.json().parts[0].passed).toBe(false);
  });

  it("rejects an unknown part", async () => {
    const r = await cli(dir, ["test", "--only", "nope"]);
    expect(r.code).toBe(ExitCode.validation);
    expect(r.err).toContain("golden, unit, conformance");
  });
});
