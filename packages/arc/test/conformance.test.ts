import { type MockLlm, startMockLlm } from "@armature/mock-llm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ArcEvent, arcSchemas, runConformance, validateEventStream } from "../src/index.ts";
import { startReferenceServer } from "./reference-server.ts";

let mock: MockLlm;
let evalApp: Awaited<ReturnType<typeof startReferenceServer>>;
let normalApp: Awaited<ReturnType<typeof startReferenceServer>>;

beforeAll(async () => {
  mock = await startMockLlm();
  evalApp = await startReferenceServer({ mockBaseUrl: mock.baseUrl, evalMode: true });
  normalApp = await startReferenceServer({ mockBaseUrl: mock.baseUrl, evalMode: false });
});
afterAll(async () => {
  await Promise.all([evalApp.close(), normalApp.close(), mock.close()]);
});

describe("ARC conformance against the reference server", () => {
  it("passes all seven checks", async () => {
    const report = await runConformance({ app: evalApp.url, normalApp: normalApp.url, mockUrl: mock.url });
    const failures = report.checks
      .filter((c) => c.status !== "PASS")
      .map((c) => `${c.id} ${c.key}: ${c.details.join("; ")}`);
    expect(failures).toEqual([]);
    expect(report.checks).toHaveLength(7);
    expect(report.passed).toBe(true);
  });

  it("fails the eval gate check when pointed at an eval-mode app", async () => {
    const report = await runConformance({ app: evalApp.url, normalApp: evalApp.url, mockUrl: mock.url });
    expect(report.checks[6]!.status).toBe("FAIL");
    expect(report.passed).toBe(false);
  });
});

describe("validateEventStream", () => {
  const ok: ArcEvent[] = [
    { type: "RUN_STARTED", threadId: "t", runId: "r" },
    { type: "TOOL_CALL_START", toolCallId: "c", toolCallName: "x" },
    { type: "TOOL_CALL_END", toolCallId: "c" },
    { type: "TOOL_CALL_RESULT", messageId: "m", toolCallId: "c", content: "{}" },
    { type: "RUN_FINISHED", threadId: "t", runId: "r" },
  ] as ArcEvent[];

  it("accepts a well-formed stream", () => {
    expect(validateEventStream(ok)).toEqual([]);
  });

  it("reports ordering, balance, and schema problems", () => {
    const bad = [
      ok[0],
      { type: "TEXT_MESSAGE_CONTENT", messageId: "nope", delta: "hi" },
      { type: "TOOL_CALL_RESULT", messageId: "m", toolCallId: "z", content: "{}" },
      { type: "CUSTOM", name: "armature.usage", value: { model: "m" } },
      ok[4],
      { type: "RUN_STARTED", threadId: "t", runId: "r" },
    ] as ArcEvent[];
    const errors = validateEventStream(bad).join("\n");
    expect(errors).toMatch(/events after terminal/);
    expect(errors).toMatch(/unopened text message/);
    expect(errors).toMatch(/never ended/);
    expect(errors).toMatch(/armature.usage payload invalid/);
  });
});

it("publishes ARC JSON schemas", () => {
  expect(Object.keys(arcSchemas())).toContain("arc-manifest.schema.json");
});
