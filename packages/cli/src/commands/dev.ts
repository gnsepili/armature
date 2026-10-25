import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, request, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { ArmatureError, compile, ExitCode, loadSpec, SPEC_FILE } from "@armature/core";
import { type MockLlm, startMockLlm } from "@armature/mock-llm";
import { playgroundDir } from "@armature/playground";
import { c, type Io } from "../io.ts";

export interface DevOptions {
  offline?: boolean;
  port?: string;
  appPort?: string;
  host?: string;
  open?: boolean;
}

export interface PlaygroundInfo {
  app_url: string;
  mode: "live" | "mock";
  framework: string;
  name: string;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(root: string, path: string, res: ServerResponse) {
  const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, "");
  let file = join(root, rel || "index.html");
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(readFileSync(file));
}

/** Streams a request to the app, so SSE events reach the browser as they happen. */
function proxy(target: URL, req: IncomingMessage, res: ServerResponse, path: string) {
  const headers = { ...req.headers, host: target.host };
  const upstream = request(
    { hostname: target.hostname, port: target.port, path, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    if (res.headersSent) res.destroy(err);
    else
      res
        .writeHead(502, { "content-type": "application/json" })
        .end(JSON.stringify({ detail: `app is not reachable at ${target.origin}: ${err.message}` }));
  });
  req.pipe(upstream);
}

/** The playground server: static UI, `/arc/*` proxied to the app, and `/__armature/info`. */
export async function startPlaygroundServer(opts: {
  appUrl: string;
  info: PlaygroundInfo;
  port: number;
  host: string;
  root?: string;
}): Promise<{ url: string; server: Server; close: () => Promise<void> }> {
  const root = resolve(opts.root ?? playgroundDir());
  const target = new URL(opts.appUrl);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/__armature/info") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(opts.info));
    } else if (url.pathname === "/arc" || url.pathname.startsWith("/arc/")) {
      proxy(target, req, res, (url.pathname.slice(4) || "/") + url.search);
    } else if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(root, url.pathname, res);
    } else {
      res.writeHead(405).end();
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port, opts.host, () => ok());
  });
  const { port } = server.address() as { port: number };
  return {
    url: `http://${opts.host}:${port}`,
    server,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}

export function venvPython(dir: string): string {
  return process.platform === "win32"
    ? join(dir, ".venv", "Scripts", "python.exe")
    : join(dir, ".venv", "bin", "python");
}

async function waitHealthy(url: string, child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new ArmatureError(
        `the app exited with code ${child.exitCode} before it was ready`,
        ExitCode.environment,
      );
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new ArmatureError(
    `the app did not answer ${url}/health within ${timeoutMs / 1000}s`,
    ExitCode.environment,
  );
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref();
  } catch {}
}

function port(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535)
    throw new ArmatureError(`${flag} must be a port number, got ${value}`, ExitCode.validation);
  return n;
}

/** Runs the app (and the mock model with --offline) plus the playground until Ctrl-C. */
export async function devCommand(io: Io, dirArg: string | undefined, opts: DevOptions): Promise<number> {
  const dir = resolve(io.cwd, dirArg ?? ".");
  const { spec } = loadSpec(join(dir, SPEC_FILE));
  const { plan } = compile(spec, { allowExperimental: true });
  const python = venvPython(dir);
  if (!existsSync(python))
    throw new ArmatureError(
      `no virtual environment in ${dir}`,
      ExitCode.environment,
      "run `uv sync` in the project first",
    );
  const host = opts.host ?? "127.0.0.1";
  const appPort = port(opts.appPort, 8000, "--app-port");
  const uiPort = port(opts.port, 5174, "--port");

  let mock: MockLlm | undefined;
  const env: NodeJS.ProcessEnv = { ...io.env };
  if (opts.offline) {
    mock = await startMockLlm({ port: 0, host: "127.0.0.1" });
    env.ARMATURE_MODEL_MODE = "mock";
    env.ARMATURE_MOCK_URL = mock.baseUrl;
  } else {
    env.ARMATURE_MODEL_MODE ??= "live";
    if (env.ARMATURE_MODEL_MODE === "live" && !env[plan.model.api_key_env])
      io.stderr(
        `${c.yellow("warn ")} ${plan.model.api_key_env} is not set; model calls will fail. Use --offline for the mock model.\n`,
      );
  }

  const child = spawn(python, ["-m", plan.package, "serve", "--host", host, "--port", String(appPort)], {
    cwd: dir,
    env,
    stdio: "inherit",
  });
  const appUrl = `http://${host}:${appPort}`;
  let ui: Awaited<ReturnType<typeof startPlaygroundServer>> | undefined;
  const cleanup = async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await ui?.close();
    await mock?.close();
  };

  try {
    await waitHealthy(appUrl, child);
    ui = await startPlaygroundServer({
      appUrl,
      host,
      port: uiPort,
      info: {
        app_url: appUrl,
        mode: env.ARMATURE_MODEL_MODE === "mock" ? "mock" : "live",
        framework: plan.framework,
        name: plan.name,
      },
    });
  } catch (err) {
    await cleanup();
    throw err;
  }

  io.stdout(
    [
      "",
      `${c.green("ready")} ${c.bold(plan.name)} ${c.dim(`(${plan.framework}, ${opts.offline ? "mock model" : plan.model.id})`)}`,
      `  playground  ${c.cyan(ui.url)}`,
      `  app         ${appUrl}  ${c.dim("(/docs for OpenAPI)")}`,
      `  chat        armature chat --url ${appUrl}`,
      c.dim("Ctrl-C to stop."),
      "",
    ].join("\n"),
  );
  if (opts.open !== false) openBrowser(ui.url);

  let stopping = false;
  const code = await new Promise<number>((done) => {
    const stop = () => {
      stopping = true;
      done(ExitCode.ok);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("exit", (status, signal) => {
      // Ctrl-C in a terminal reaches the app too; that is a normal shutdown.
      if (stopping || status === 0 || signal === "SIGINT" || signal === "SIGTERM") return stop();
      io.stderr(`${c.red("error")} the app stopped (exit ${status ?? signal})\n`);
      done(ExitCode.environment);
    });
  });
  stopping = true;
  await cleanup();
  return code;
}
