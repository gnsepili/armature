import { createInterface } from "node:readline/promises";
import { ArcClient, type ArcEvent } from "@armature/arc";
import { ArmatureError, ExitCode } from "@armature/core";
import { c, type Io, printJson } from "../io.ts";

export interface ChatOptions {
  url?: string;
  thread?: string;
  message?: string;
  json?: boolean;
}

interface PendingApproval {
  tool_call_id: string;
  name: string;
  args: unknown;
  side_effect: string;
}

type Ask = (question: string) => Promise<string>;

interface TurnResult {
  threadId?: string;
  status: "success" | "error" | "interrupted";
}

const short = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max)}...` : text);

/** Prints one streamed run; returns what is needed to continue or resume it. */
async function printStream(io: Io, events: AsyncIterable<ArcEvent>) {
  let threadId: string | undefined;
  let runId: string | undefined;
  let approvals: PendingApproval[] = [];
  let status: TurnResult["status"] = "success";
  let midLine = false;
  const line = (text: string) => {
    if (midLine) io.stdout("\n");
    midLine = false;
    io.stdout(`${text}\n`);
  };
  for await (const e of events) {
    switch (e.type) {
      case "RUN_STARTED":
        threadId = e.threadId as string;
        runId = e.runId as string;
        break;
      case "TEXT_MESSAGE_CONTENT":
        io.stdout(e.delta as string);
        midLine = true;
        break;
      case "TEXT_MESSAGE_END":
        if (midLine) io.stdout("\n");
        midLine = false;
        break;
      case "TOOL_CALL_START":
        line(c.dim(`  -> ${e.toolCallName as string}`));
        break;
      case "TOOL_CALL_RESULT":
        line(c.dim(`  <- ${short(String(e.content))}`));
        break;
      case "CUSTOM":
        if (e.name === "armature.approval_required")
          approvals = (e.value as { approvals: PendingApproval[] }).approvals;
        break;
      case "RUN_FINISHED":
        if ((e.outcome as { type?: string } | undefined)?.type === "interrupt") status = "interrupted";
        break;
      case "RUN_ERROR":
        status = "error";
        line(`${c.red("error")} [${e.code as string}] ${e.message as string}`);
        break;
    }
  }
  if (midLine) io.stdout("\n");
  return { threadId, runId, approvals, status };
}

async function turn(io: Io, client: ArcClient, input: string, threadId: string | undefined, ask?: Ask) {
  let r = await printStream(io, client.stream({ input, thread_id: threadId }));
  while (r.status === "interrupted" && r.runId) {
    if (!ask) {
      line(
        io,
        c.yellow(`run ${r.runId} is waiting for approval of ${r.approvals.map((a) => a.name).join(", ")}`),
      );
      line(io, c.dim("approve it in the playground, or rerun in an interactive terminal"));
      break;
    }
    const decisions = [];
    for (const a of r.approvals) {
      const answer = await ask(
        `${c.yellow("approve")} ${c.bold(a.name)} ${c.dim(`(${a.side_effect})`)} ${JSON.stringify(a.args)}? [y/N] `,
      );
      decisions.push({ tool_call_id: a.tool_call_id, approve: /^y(es)?$/i.test(answer.trim()) });
    }
    const runId: string = r.runId;
    const next = await printStream(io, client.resumeStream(runId, { decisions }));
    r = { ...next, threadId: next.threadId ?? r.threadId, runId: next.runId ?? runId };
  }
  return { threadId: r.threadId ?? threadId, status: r.status } satisfies TurnResult;
}

const line = (io: Io, text: string) => io.stdout(`${text}\n`);

async function reachable(client: ArcClient) {
  try {
    return await client.health();
  } catch (err) {
    throw new ArmatureError(
      `no Armature app at ${client.baseUrl} (${(err as Error).message})`,
      ExitCode.environment,
      "start it with `armature dev` (or `python -m <package> serve`), or pass --url",
    );
  }
}

/** Terminal chat against a running app over ARC. */
export async function chatCommand(io: Io, opts: ChatOptions, ask?: Ask): Promise<number> {
  const client = new ArcClient(opts.url ?? "http://127.0.0.1:8000");
  const health = await reachable(client);
  let threadId = opts.thread;

  if (opts.message !== undefined) {
    if (opts.json) {
      const result = await client.wait({ input: opts.message, thread_id: threadId });
      printJson(io, { ok: result.status !== "error", ...result });
      return result.status === "error" ? ExitCode.environment : ExitCode.ok;
    }
    const r = await turn(io, client, opts.message, threadId, io.interactive ? ask : undefined);
    return r.status === "error" ? ExitCode.environment : ExitCode.ok;
  }
  if (opts.json) throw new ArmatureError("--json needs --message", ExitCode.validation);

  const manifest = await client.manifest();
  line(
    io,
    `${c.bold(manifest.name)} ${c.dim(`${manifest.framework} · ${health.model_mode} model · ${client.baseUrl}`)}`,
  );
  line(io, c.dim("/new starts a new thread, /exit quits."));
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: io.interactive });
  const prompt: Ask = (q) => rl.question(q);
  try {
    for (;;) {
      let input: string;
      try {
        input = (await rl.question(c.cyan("> "))).trim();
      } catch {
        break; // stdin closed
      }
      if (!input) continue;
      if (input === "/exit" || input === "/quit") break;
      if (input === "/new") {
        threadId = undefined;
        line(io, c.dim("new thread"));
        continue;
      }
      try {
        threadId = (await turn(io, client, input, threadId, ask ?? prompt)).threadId;
      } catch (err) {
        line(io, `${c.red("error")} ${(err as Error).message}`);
      }
    }
  } finally {
    rl.close();
  }
  return ExitCode.ok;
}
