import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExitCode } from "@armature/core";
import { type MockLlm, startMockLlm } from "@armature/mock-llm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startReferenceServer } from "../../arc/test/reference-server.ts";
import { chatCommand } from "../src/commands/chat.ts";
import { startPlaygroundServer } from "../src/commands/dev.ts";
import { cli, tempDir, testIo } from "./helpers.ts";

let mock: MockLlm;
let app: Awaited<ReturnType<typeof startReferenceServer>>;

beforeAll(async () => {
  mock = await startMockLlm();
  app = await startReferenceServer({ mockBaseUrl: mock.baseUrl, evalMode: false });
});
afterAll(async () => {
  await Promise.all([app.close(), mock.close()]);
});

describe("armature chat", () => {
  it("-m --json prints the finished run", async () => {
    const r = await cli(tempDir(), ["chat", "--url", app.url, "-m", "look up item 7", "--json"]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    const body = r.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("success");
    expect(body.thread_id).toBeTruthy();
  });

  it("-m streams text and tool calls", async () => {
    const r = await cli(tempDir(), ["chat", "--url", app.url, "-m", "please lookup item 7"]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    expect(r.out).toContain("-> lookup_item");
    expect(r.out).toContain("<- ");
  });

  it("without a terminal, reports a pending approval instead of prompting", async () => {
    const r = await cli(tempDir(), ["chat", "--url", app.url, "-m", "save note: hello"]);
    expect(r.code, r.err).toBe(ExitCode.ok);
    expect(r.out).toContain("waiting for approval of save_note");
  });

  it("asks for each approval in a terminal and resumes the run", async () => {
    const io = { ...testIo(tempDir()), interactive: true };
    const questions: string[] = [];
    const code = await chatCommand(io, { url: app.url, message: "save note: hello" }, async (q) => {
      questions.push(q);
      return "y";
    });
    expect(code).toBe(ExitCode.ok);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain("save_note");
    expect(io.out.join("")).toContain("-> save_note");
  });

  it("exits 5 with a hint when no app is running", async () => {
    const r = await cli(tempDir(), ["chat", "--url", "http://127.0.0.1:9", "-m", "hi"]);
    expect(r.code).toBe(ExitCode.environment);
    expect(r.err).toContain("armature dev");
  });
});

describe("playground server", () => {
  let ui: Awaited<ReturnType<typeof startPlaygroundServer>>;
  const root = tempDir();

  beforeAll(async () => {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<h1>playground</h1>");
    writeFileSync(join(root, "app.js"), "console.log(1)");
    ui = await startPlaygroundServer({
      appUrl: app.url,
      host: "127.0.0.1",
      port: 0,
      root,
      info: { app_url: app.url, mode: "mock", framework: "langgraph", name: "reference" },
    });
  });
  afterAll(() => ui.close());

  it("serves the UI with an index fallback", async () => {
    const js = await fetch(`${ui.url}/app.js`);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await (await fetch(`${ui.url}/some/route`)).text()).toContain("playground");
  });

  it("does not serve files outside its root", async () => {
    const r = await fetch(`${ui.url}/..%2f..%2fetc%2fpasswd`);
    expect(await r.text()).not.toContain("root:");
  });

  it("serves the session info", async () => {
    const info = await (await fetch(`${ui.url}/__armature/info`)).json();
    expect(info).toMatchObject({ mode: "mock", name: "reference" });
  });

  it("proxies ARC, including the SSE stream", async () => {
    const health = (await (await fetch(`${ui.url}/arc/health`)).json()) as { status: string };
    expect(health.status).toBe("ok");
    const res = await fetch(`${ui.url}/arc/runs/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "lookup item 3" }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("RUN_STARTED");
    expect(body).toContain("RUN_FINISHED");
  });

  it("answers 502 when the app is down", async () => {
    const down = await startPlaygroundServer({
      appUrl: "http://127.0.0.1:9",
      host: "127.0.0.1",
      port: 0,
      root,
      info: { app_url: "http://127.0.0.1:9", mode: "live", framework: "langgraph", name: "x" },
    });
    const r = await fetch(`${down.url}/arc/health`);
    expect(r.status).toBe(502);
    await down.close();
  });
});
