/**
 * The `armature` program. `run` never calls process.exit, so tests drive it in-process
 * with their own Io and read the exit code it returns.
 */
import { ARMATURE_VERSION, ExitCode } from "@armature/core";
import { Command, CommanderError } from "commander";
import { chatCommand } from "./commands/chat.ts";
import { devCommand } from "./commands/dev.ts";
import { generateCommand } from "./commands/generate.ts";
import { initCommand } from "./commands/init.ts";
import { planCommand } from "./commands/plan.ts";
import { type Io, printFailure, processIo, toFailure } from "./io.ts";

const collect = (value: string, previous: string[] = []) => [...previous, value];

function program(io: Io, setCode: (code: number) => void): Command {
  const action =
    <A extends unknown[]>(fn: (...args: A) => number | Promise<number>) =>
    async (...args: A) => {
      setCode(await fn(...args));
    };

  const root = new Command("armature")
    .description("Compile armature.yaml into a framework-native Python agent project, eval-first.")
    .version(ARMATURE_VERSION, "-v, --version")
    .showHelpAfterError()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride();

  root
    .command("init")
    .description("Create armature.yaml and generate a new agent project")
    .argument("[dir]", "target directory (default: ./<name>)")
    .option("-o, --output <dir>", "target directory (overrides [dir])")
    .option("-y, --yes", "accept defaults, never prompt")
    .option("--config <file>", "start from a spec file (YAML or JSON); - reads stdin")
    .option("--name <slug>", "agent name")
    .option("--description <text>", "one-line description")
    .option("--framework <id>", "langgraph | openai-agents (others are planned)")
    .option("--pattern <id>", "single_agent_tools")
    .option("--provider <id>", "openai | anthropic | openai_compatible")
    .option("--model <id>", "model ID (default: the provider's suggested model)")
    .option("--base-url <url>", "endpoint for openai_compatible")
    .option("--with <tokens>", "capabilities: memory, memory:sqlite, no-memory", collect)
    .option("--tool <name:side_effect:args>", "add a tool, e.g. lookup_order:read:order_id", collect)
    .option("--assistant <targets>", "claude, codex, generic or both", collect)
    .option("--dry-run", "show what would be written")
    .option("--force", "write into a non-empty directory or replace armature.yaml")
    .option("--experimental", "allow models and endpoints outside the verified catalog")
    .option("--json", "machine-readable output")
    .action(action((dir: string | undefined, opts) => initCommand(io, dir, opts)));

  root
    .command("generate")
    .description("Regenerate the project from armature.yaml, keeping your edits")
    .argument("[dir]", "project directory", ".")
    .option("--spec <file>", "spec path (default: <dir>/armature.yaml)")
    .option("--force", "overwrite managed files you edited")
    .option("--dry-run", "show what would change")
    .option("--experimental", "allow models and endpoints outside the verified catalog")
    .option("--verbose", "list unchanged files too")
    .option("--json", "machine-readable output")
    .action(action((dir: string, opts) => generateCommand(io, dir, opts)));

  root
    .command("plan")
    .description("Explain what generate would build and change; writes nothing")
    .argument("[dir]", "project directory", ".")
    .option("--spec <file>", "spec path (default: <dir>/armature.yaml)")
    .option("--experimental", "treat experimental models as allowed")
    .option("--json", "machine-readable output")
    .action(action((dir: string, opts) => planCommand(io, dir, opts)));

  root
    .command("dev")
    .description("Run the app and the web playground")
    .argument("[dir]", "project directory", ".")
    .option("--offline", "use the bundled mock model; no API key needed")
    .option("--port <n>", "playground port", "5174")
    .option("--app-port <n>", "app port", "8000")
    .option("--host <host>", "bind address", "127.0.0.1")
    .option("--no-open", "do not open a browser")
    .action(action((dir: string, opts) => devCommand(io, dir, opts)));

  root
    .command("chat")
    .description("Chat with a running app in the terminal")
    .option("--url <url>", "app URL", "http://127.0.0.1:8000")
    .option("--thread <id>", "continue a thread")
    .option("-m, --message <text>", "send one message and exit")
    .option("--json", "with --message: print the ARC run result")
    .action(action((opts) => chatCommand(io, opts)));

  for (const cmd of root.commands) {
    cmd.exitOverride();
    cmd.configureOutput({ writeOut: io.stdout, writeErr: io.stderr });
    cmd.showHelpAfterError();
  }
  return root;
}

/** Runs the CLI and returns the process exit code. */
export async function run(argv: string[], io: Io = processIo()): Promise<number> {
  let code: number = ExitCode.ok;
  const json = argv.includes("--json");
  const root = program(io, (c) => {
    code = c;
  });
  try {
    await root.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version exit through here with code 0.
      return err.exitCode === 0 ? ExitCode.ok : ExitCode.validation;
    }
    const failure = toFailure(err);
    printFailure(io, failure, json);
    return failure.exit_code;
  }
  return code;
}
