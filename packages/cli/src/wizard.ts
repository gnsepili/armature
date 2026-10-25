/**
 * The interactive `armature init` wizard (PRD §5.2). Every step has a default, so pressing
 * Enter all the way through yields a runnable example. The answers become the same flags
 * the non-interactive path uses, plus the intent block.
 */

import { ArmatureError, compile, ExitCode, findModel, suggestedModels } from "@armature/core";
import { parseAgentSpec, SLUG, TOOL_NAME } from "@armature/schema";
import * as p from "@clack/prompts";
import { c } from "./io.ts";
import { DEFAULTS, defaultModel, type RawSpec, type SpecFlags, specFromFlags } from "./spec.ts";

function answer<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Cancelled. Nothing was written.");
    throw new ArmatureError("init cancelled", ExitCode.validation);
  }
  return value as Exclude<T, symbol>;
}

const list = (text: string) =>
  text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

async function intentStep(name: string) {
  p.log.step("A. Intent and success");
  const agentName = answer(
    await p.text({
      message: "Agent name",
      initialValue: name,
      validate: (v) => (SLUG.test(v ?? "") ? undefined : "lowercase letters, digits and hyphens, 3-64 chars"),
    }),
  );
  const problem = answer(
    await p.text({ message: "What does it do?", placeholder: "Answers order questions and issues refunds" }),
  );
  const targetUser = answer(await p.text({ message: "Who uses it?", placeholder: "support agents" }));
  const examples: { request: string; desired_outcome: string }[] = [];
  while (examples.length < 5) {
    const request = answer(
      await p.text({
        message: `Example request ${examples.length + 1} ${c.dim("(empty to finish)")}`,
        placeholder: examples.length ? "" : "Where is order 1042?",
      }),
    );
    if (!request?.trim()) break;
    const outcome = answer(await p.text({ message: "Desired outcome", placeholder: "status and ETA" }));
    examples.push({ request: request.trim(), desired_outcome: (outcome ?? "").trim() });
  }
  const success = answer(
    await p.text({ message: `Success criteria ${c.dim("(separate with ;)")}`, placeholder: "" }),
  );
  const prohibited = answer(
    await p.text({
      message: `What must it never do? ${c.dim("(separate with ;)")}`,
      placeholder: "refund without approval; reveal other customers' data",
    }),
  );
  const writeScope = answer(
    await p.text({ message: "Which external writes may it make, if any?", placeholder: "none" }),
  );
  return {
    name: agentName,
    description: (problem ?? "").trim(),
    intent: {
      problem: (problem ?? "").trim(),
      target_user: (targetUser ?? "").trim(),
      examples,
      success_criteria: list(success ?? ""),
      prohibited_actions: list(prohibited ?? ""),
      write_scope: (writeScope ?? "").trim(),
    },
  };
}

async function stackStep() {
  p.log.step("B. Stack");
  const framework = answer(
    await p.select({
      message: "Framework",
      initialValue: DEFAULTS.framework as string,
      options: [
        { value: "langgraph", label: "LangGraph", hint: "graph runtime, checkpointed approvals" },
        { value: "openai-agents", label: "OpenAI Agents SDK", hint: "OpenAI-compatible models only" },
      ],
    }),
  );
  const pattern = answer(
    await p.select({
      message: "Pattern",
      initialValue: "single_agent_tools",
      options: [
        { value: "single_agent_tools", label: "Single agent with tools", hint: "recommended" },
        { value: "workflow", label: "Fixed workflow", hint: "not supported yet", disabled: true },
        { value: "supervisor", label: "Supervisor + specialists", hint: "not supported yet", disabled: true },
      ],
    }),
  );
  const assistant = answer(
    await p.multiselect({
      message: "Coding assistants to hand off to",
      initialValues: ["claude", "codex"],
      required: true,
      options: [
        { value: "claude", label: "Claude Code" },
        { value: "codex", label: "Codex" },
        { value: "generic", label: "Generic (AGENTS.md only)" },
      ],
    }),
  );
  return { framework, pattern, assistant };
}

async function modelStep(framework: string) {
  p.log.step("C. Model");
  const providers =
    framework === "openai-agents"
      ? ["openai", "openai_compatible"]
      : ["openai", "anthropic", "openai_compatible"];
  const provider = answer(
    await p.select({
      message: "Provider",
      initialValue: "openai",
      options: providers.map((v) => ({
        value: v,
        label: v === "openai_compatible" ? "OpenAI-compatible endpoint" : v[0]!.toUpperCase() + v.slice(1),
      })),
    }),
  );
  let model: string | undefined;
  let baseUrl: string | undefined;
  const suggested = suggestedModels(provider);
  if (suggested.length) {
    const picked = answer(
      await p.select({
        message: "Model",
        initialValue: defaultModel(provider),
        options: [
          ...suggested.map((m) => ({
            value: m.id,
            label: m.id,
            hint: `$${m.price.input}/$${m.price.output} per 1M tokens`,
          })),
          { value: "__other", label: "Other model ID" },
        ],
      }),
    );
    model = picked === "__other" ? undefined : picked;
  }
  if (!model) {
    model = answer(
      await p.text({ message: "Model ID", validate: (v) => (v?.trim() ? undefined : "required") }),
    ).trim();
    if (!findModel(provider, model))
      p.log.warn(
        "This model is not in the verified catalog; it will be marked experimental and cost NOT_MEASURED.",
      );
  }
  if (provider === "openai_compatible") {
    baseUrl = answer(
      await p.text({
        message: "Base URL",
        placeholder: "http://localhost:8080/v1",
        validate: (v) => (/^https?:\/\//.test(v ?? "") ? undefined : "an http(s) URL"),
      }),
    );
  }
  return { provider, model, baseUrl };
}

async function toolStep() {
  const tools: { name: string; side_effect: string; args: { name: string }[] }[] = [];
  for (;;) {
    const name = answer(
      await p.text({
        message: `Tool name ${c.dim("(snake_case, empty to finish)")}`,
        validate: (v) => (!v || TOOL_NAME.test(v) ? undefined : "lowercase snake_case"),
      }),
    );
    if (!name) break;
    const sideEffect = answer(
      await p.select({
        message: `What does ${name} change?`,
        initialValue: "read",
        options: [
          { value: "none", label: "Nothing (pure computation)" },
          { value: "read", label: "Reads data" },
          { value: "write", label: "Writes data", hint: "needs approval by default" },
          { value: "destructive", label: "Deletes or moves money", hint: "needs approval" },
        ],
      }),
    );
    const args = answer(
      await p.text({ message: `Arguments ${c.dim("(comma separated)")}`, placeholder: "order_id" }),
    );
    tools.push({
      name,
      side_effect: sideEffect,
      args: (args ?? "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => ({ name: a })),
    });
  }
  return tools;
}

async function capabilitiesStep() {
  p.log.step("D. Capabilities");
  const preset = answer(
    await p.select({
      message: "Capabilities",
      initialValue: "recommended",
      options: [
        {
          value: "recommended",
          label: "Recommended",
          hint: "in-memory sessions, example tools, limits, approvals for writes",
        },
        { value: "custom", label: "Customize" },
      ],
    }),
  );
  if (preset === "recommended") return { with: [] as string[], tools: [] };
  const memory = answer(
    await p.select({
      message: "Session memory",
      initialValue: "memory",
      options: [
        { value: "memory", label: "In memory", hint: "lost on restart" },
        { value: "memory:sqlite", label: "SQLite file", hint: ".armature/sessions.db" },
        { value: "no-memory", label: "Off", hint: "every run starts fresh" },
      ],
    }),
  );
  return { with: [memory], tools: await toolStep() };
}

/** Runs the wizard and returns a raw spec, or throws when cancelled. */
export async function runWizard(defaultName: string, dir: string): Promise<RawSpec> {
  p.intro(c.bold("armature init"));
  const a = await intentStep(defaultName);
  const b = await stackStep();
  const m = await modelStep(b.framework);
  const d = await capabilitiesStep();
  p.log.step("E. Developer surfaces");
  p.log.message("Terminal chat, web playground, REST + OpenAPI and SSE streaming are all on.");

  const flags: SpecFlags = {
    name: a.name,
    description: a.description,
    framework: b.framework,
    pattern: b.pattern,
    provider: m.provider,
    model: m.model,
    baseUrl: m.baseUrl,
    with: d.with,
    assistant: b.assistant,
  };
  const spec: RawSpec = specFromFlags(flags, dir, { schema_version: 1, intent: a.intent });
  if (d.tools.length) spec.capabilities = { ...(spec.capabilities ?? {}), custom_tools: d.tools };

  p.log.step("F. Evaluation preview");
  const examples = a.intent.examples.length;
  p.log.message(
    `${Math.max(examples, 1)} happy-path, 1 edge and ${Math.max(a.intent.prohibited_actions.length, 1)} prohibited-action seed case(s), all DRAFT_UNVERIFIED.\n` +
      "You confirm the expected outcomes before the benchmark is frozen; Armature never invents ground truth.",
  );

  p.log.step("G. Confirm");
  const { plan, compat, files } = compile(parseAgentSpec(spec), { allowExperimental: true });
  const secrets = [plan.model.api_key_env, ...plan.tools.flatMap((t) => (t.auth_env ? [t.auth_env] : []))];
  p.note(
    [
      `${plan.framework} · ${plan.pattern} · Python ${plan.python_version}`,
      `model    ${plan.model.provider}/${plan.model.id}${plan.model.known ? "" : c.yellow(" (experimental)")}`,
      `tools    ${plan.tools.map((t) => `${t.name}${t.requires_approval ? "*" : ""}${t.mode === "stub" ? " (stub)" : ""}`).join(", ")}`,
      `memory   ${plan.session_memory.enabled ? plan.session_memory.backend : "off"}`,
      `files    ${files.length}   packages ${plan.dependencies.length}`,
      `secrets  ${secrets.join(", ")} ${c.dim("(not needed for --offline)")}`,
      c.dim("* needs approval before it runs. Stubs return TODO results until you implement them."),
      ...compat.findings.filter((f) => f.level !== "info").map((f) => c.yellow(`! ${f.message}`)),
    ].join("\n"),
    plan.name,
  );
  const ok = answer(await p.confirm({ message: `Generate into ${dir}?`, initialValue: true }));
  if (!ok) {
    p.cancel("Nothing was written.");
    throw new ArmatureError("init cancelled", ExitCode.validation);
  }
  return spec;
}
