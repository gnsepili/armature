import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type MockLlm, NULL_AGENT_REPLY, startMockLlm, synthesize } from "../src/index.ts";

const lookup = {
  type: "function" as const,
  function: {
    name: "lookup_item",
    parameters: {
      type: "object",
      properties: { item_id: { type: "string" }, n: { type: "integer" } },
      required: ["item_id"],
    },
  },
};

let mock: MockLlm;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(() => mock.close());

async function chat(body: Record<string, unknown>) {
  const res = await fetch(`${mock.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-model", ...body }),
  });
  return { status: res.status, text: await res.text() };
}

describe("synthesize", () => {
  it("fills required properties and follows refs", () => {
    expect(synthesize(lookup.function.parameters)).toEqual({ item_id: "example" });
    const schema = {
      $defs: { A: { type: "object", properties: { x: { enum: ["a", "b"] } } } },
      $ref: "#/$defs/A",
    };
    expect(synthesize(schema)).toEqual({ x: "a" });
    expect(synthesize({ anyOf: [{ type: "null" }, { type: "integer", minimum: 3 }] })).toBe(3);
  });
});

describe("smoke mode", () => {
  it("calls the named tool, then summarizes its result", async () => {
    const first = JSON.parse(
      (await chat({ messages: [{ role: "user", content: "please lookup item 7" }], tools: [lookup] })).text,
    );
    const call = first.choices[0].message.tool_calls[0];
    expect(call.function.name).toBe("lookup_item");
    expect(JSON.parse(call.function.arguments)).toEqual({ item_id: "example" });
    expect(first.choices[0].finish_reason).toBe("tool_calls");

    const second = JSON.parse(
      (
        await chat({
          tools: [lookup],
          messages: [
            { role: "user", content: "please lookup item 7" },
            { role: "assistant", content: null, tool_calls: [call] },
            { role: "tool", tool_call_id: call.id, content: '{"name":"Widget"}' },
          ],
        })
      ).text,
    );
    expect(second.choices[0].message.content).toBe('Mock response: lookup_item returned {"name":"Widget"}');
    expect(second.usage.total_tokens).toBeGreaterThan(0);
  });

  it("returns schema-shaped JSON when the system prompt carries an output schema", async () => {
    const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
    const body = JSON.parse(
      (
        await chat({
          messages: [
            {
              role: "system",
              content: `Be useful.\n<output_schema>${JSON.stringify(schema)}</output_schema>`,
            },
            { role: "user", content: "hi" },
          ],
        })
      ).text,
    );
    expect(JSON.parse(body.choices[0].message.content)).toEqual({ answer: "example" });
  });

  it("streams OpenAI-style chunks with usage and [DONE]", async () => {
    const { text } = await chat({
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "hello there" }],
    });
    const events = text
      .split("\n\n")
      .filter(Boolean)
      .map((l) => l.replace(/^data: /, ""));
    expect(events.at(-1)).toBe("[DONE]");
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
    const content = chunks.map((c) => c.choices[0]?.delta?.content ?? "").join("");
    expect(content).toBe("Mock response (turn 1): hello there");
    expect(chunks.at(-1).usage.prompt_tokens).toBeGreaterThan(0);
  });
});

describe("scripts and control API", () => {
  it("serves scripted steps by assistant-turn index and logs requests", async () => {
    await fetch(`${mock.url}/__mock/scripts`, {
      method: "POST",
      body: JSON.stringify({
        match: "save it",
        steps: [{ tool_calls: [{ name: "save_note", args: { text: "x" }, id: "c1" }] }, { text: "saved" }],
      }),
    });
    const a = JSON.parse((await chat({ messages: [{ role: "user", content: "save it" }] })).text);
    expect(a.choices[0].message.tool_calls[0]).toMatchObject({
      id: "c1",
      function: { name: "save_note", arguments: '{"text":"x"}' },
    });
    const b = JSON.parse(
      (
        await chat({
          messages: [
            { role: "user", content: "save it" },
            { role: "assistant", tool_calls: a.choices[0].message.tool_calls },
            { role: "tool", tool_call_id: "c1", content: "ok" },
          ],
        })
      ).text,
    );
    expect(b.choices[0].message.content).toBe("saved");
    const log = (await (await fetch(`${mock.url}/__mock/log`)).json()) as {
      requests: Array<{ served: string; step?: number }>;
    };
    expect(log.requests.filter((r) => r.served === "script").map((r) => r.step)).toEqual([0, 1]);
  });

  it("returns scripted errors with their status", async () => {
    mock.addScripts([{ match: "boom", steps: [{ error: { status: 429, message: "rate limited" } }] }]);
    const res = await chat({ messages: [{ role: "user", content: "boom" }] });
    expect(res.status).toBe(429);
  });

  it("null mode always declines and never calls tools", async () => {
    await fetch(`${mock.url}/__mock/mode`, { method: "PUT", body: JSON.stringify({ mode: "null" }) });
    const body = JSON.parse(
      (await chat({ messages: [{ role: "user", content: "lookup_item 1" }], tools: [lookup] })).text,
    );
    expect(body.choices[0].message.content).toBe(NULL_AGENT_REPLY);
    mock.setMode("smoke");
  });
});
