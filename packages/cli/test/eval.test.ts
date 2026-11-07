import { join } from "node:path";
import { ExitCode } from "@armature/core";
import { beforeAll, describe, expect, it } from "vitest";
import { cli, tempDir } from "./helpers.ts";

// These checks never start the app; the integration suite covers offline runs end to end.
let dir: string;
beforeAll(async () => {
  const cwd = tempDir();
  const r = await cli(cwd, ["init", "--yes", "--name", "demo", "--tool", "lookup_order:read:order_id"]);
  expect(r.code, r.err).toBe(ExitCode.ok);
  dir = join(cwd, "demo");
});

describe("armature eval", () => {
  it("validate --static passes on the seeded benchmark", async () => {
    const r = await cli(dir, ["eval", "validate", "--static", "--json"]);
    expect(r.code, r.out).toBe(ExitCode.ok);
    const body = r.json();
    expect(body.ok).toBe(true);
    expect(body.dynamic).toBeNull();
    expect(body.suites.find((s: { name: string }) => s.name === "smoke").cases).toBeGreaterThan(0);
  });

  it("run refuses an unknown suite", async () => {
    const r = await cli(dir, ["eval", "run", "--suite", "nope", "--offline"]);
    expect(r.code).toBe(ExitCode.validation);
    expect(r.err).toContain('no suite "nope"');
  });

  it("run refuses a live run of an offline-only suite", async () => {
    const r = await cli(dir, ["eval", "run", "--suite", "smoke"]);
    expect(r.code).toBe(ExitCode.validation);
    expect(r.err).toContain("--offline");
  });

  it("run refuses an unknown case id and a bad --trials", async () => {
    const a = await cli(dir, ["eval", "run", "--suite", "smoke", "--offline", "--case", "missing"]);
    expect(a.code).toBe(ExitCode.validation);
    const b = await cli(dir, ["eval", "run", "--suite", "smoke", "--offline", "--trials", "0"]);
    expect(b.code).toBe(ExitCode.validation);
  });

  it("report says how to make a first run", async () => {
    const r = await cli(dir, ["eval", "report"]);
    expect(r.code).toBe(ExitCode.validation);
    expect(r.err).toContain("armature eval run");
  });

  it("freeze refuses while cases are drafts", async () => {
    const r = await cli(dir, ["eval", "freeze", "--json"]);
    expect(r.code).toBe(ExitCode.validation);
    expect(r.json().error.message).toContain("not VERIFIED");
  });
});
