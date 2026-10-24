// Armature playground: talks to the generated agent through the ARC v1 HTTP API.
// Every request goes to /arc/*, which `armature dev` proxies to the Python app.

const API = "/arc";
const WRITE_EFFECTS = new Set(["write", "destructive"]);

const state = {
  info: null,
  manifest: null,
  appName: "agent",
  memoryEnabled: false,
  threads: [],
  threadId: null,
  busy: false,
  stickToBottom: true,
  awaitingApproval: false,
};

const els = {
  agentName: document.getElementById("agent-name"),
  agentMeta: document.getElementById("agent-meta"),
  modeBadge: document.getElementById("mode-badge"),
  linkDocs: document.getElementById("link-docs"),
  linkManifest: document.getElementById("link-manifest"),
  linkHealth: document.getElementById("link-health"),
  banner: document.getElementById("banner"),
  threadList: document.getElementById("thread-list"),
  newThread: document.getElementById("new-thread"),
  messages: document.getElementById("messages"),
  emptyState: document.getElementById("empty-state"),
  composer: document.getElementById("composer"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  agentDescription: document.getElementById("agent-description"),
  toolList: document.getElementById("tool-list"),
  limits: document.getElementById("limits"),
};

// ---------------------------------------------------------------- helpers

/** Build a DOM node. Children are strings (always text, never HTML) or nodes. */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function toText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** Pretty-print JSON text when it parses, otherwise return it unchanged. */
function prettyJson(value) {
  if (typeof value !== "string") return toText(value);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatMs(ms) {
  if (typeof ms !== "number") return "not measured";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function formatCost(cost) {
  if (typeof cost !== "number") return "not measured";
  return `$${cost < 0.01 ? cost.toFixed(5) : cost.toFixed(4)}`;
}

function sideEffectBadge(effect) {
  const kind = effect || "none";
  return h("span", { class: `badge badge-effect badge-${kind}` }, kind);
}

async function getJson(path) {
  const response = await fetch(`${API}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok)
    throw Object.assign(new Error(`${path} returned ${response.status}`), { status: response.status });
  return response.json();
}

function isNearBottom(node) {
  return node.scrollHeight - node.scrollTop - node.clientHeight < 80;
}

function scrollToBottom(force = false) {
  if (force || state.stickToBottom !== false) els.messages.scrollTop = els.messages.scrollHeight;
}

els.messages.addEventListener("scroll", () => {
  state.stickToBottom = isNearBottom(els.messages);
});

// ---------------------------------------------------------------- header + side panel

async function loadInfo() {
  let info = null;
  try {
    const response = await fetch("/__armature/info");
    if (response.ok) info = await response.json();
  } catch {
    // Served without `armature dev`; fall back to the proxy path below.
  }
  state.info = info;
  const appUrl = info?.app_url ?? API;
  els.linkDocs.href = `${appUrl}/docs`;
  els.linkManifest.href = `${appUrl}/manifest`;
  els.linkHealth.href = `${appUrl}/health`;
  return info;
}

function setMode(mode) {
  const live = mode === "live";
  els.modeBadge.hidden = !mode;
  els.modeBadge.textContent = live ? "LIVE" : "MOCK";
  els.modeBadge.className = `badge badge-mode ${live ? "badge-live" : "badge-mock"}`;
  els.modeBadge.title = live ? "Calling a real model" : "Using the mock LLM";
}

function renderHeader(info, health, manifest) {
  state.appName = manifest?.name ?? info?.name ?? "agent";
  els.agentName.textContent = state.appName;
  document.title = `${state.appName} - Armature playground`;
  const model = manifest?.model ? `${manifest.model.provider}/${manifest.model.id}` : null;
  const framework = manifest?.framework ?? health?.framework ?? info?.framework;
  els.agentMeta.textContent =
    [framework, model, manifest?.pattern].filter(Boolean).join(" · ") || "Connected";
  setMode(health?.model_mode ?? info?.mode);
}

function renderManifest(manifest) {
  els.agentDescription.textContent = manifest.description ?? "";
  els.toolList.replaceChildren();
  const tools = manifest.tools ?? [];
  if (tools.length === 0) els.toolList.append(h("li", { class: "muted small" }, "This agent has no tools."));
  for (const tool of tools) {
    const effect = tool.side_effect ?? "none";
    els.toolList.append(
      h(
        "li",
        { class: `tool-item${WRITE_EFFECTS.has(effect) ? ` tool-item-${effect}` : ""}` },
        h(
          "div",
          { class: "tool-item-head" },
          h("code", { class: "tool-name" }, tool.name),
          sideEffectBadge(effect),
          tool.requires_approval ? h("span", { class: "badge badge-approval" }, "needs approval") : null,
        ),
        tool.description ? h("p", { class: "muted small" }, tool.description) : null,
      ),
    );
  }
  const limits = manifest.limits ?? {};
  els.limits.replaceChildren();
  for (const [key, value] of Object.entries(limits)) {
    els.limits.append(h("dt", {}, key.replaceAll("_", " ")), h("dd", {}, String(value)));
  }
}

function showBanner(message, kind = "warn") {
  els.banner.hidden = false;
  els.banner.className = `banner banner-${kind}`;
  els.banner.textContent = message;
}

async function loadAgent() {
  const info = await loadInfo();
  const [health, manifest] = await Promise.all([
    getJson("/health").catch((error) => ({ error })),
    getJson("/manifest").catch((error) => ({ error })),
  ]);
  if (health.error || manifest.error) {
    renderHeader(info, null, null);
    showBanner(
      `Cannot reach the agent app through ${API}/. Is it running? (${(health.error ?? manifest.error).message})`,
      "error",
    );
    return;
  }
  state.manifest = manifest;
  state.memoryEnabled = Boolean(manifest.capabilities?.session_memory?.enabled);
  renderHeader(info, health, manifest);
  renderManifest(manifest);
  if (health.model_mode === "live" && health.ready?.credentials === false) {
    showBanner("Live mode is on but the app reports missing model credentials, so runs will fail.");
  }
  loadThreads();
}

// ---------------------------------------------------------------- threads

function threadsKey() {
  return `armature.playground.threads.${state.appName}`;
}

function loadThreads() {
  try {
    state.threads = JSON.parse(localStorage.getItem(threadsKey()) ?? "[]");
  } catch {
    state.threads = [];
  }
  renderThreads();
}

function saveThreads() {
  try {
    localStorage.setItem(threadsKey(), JSON.stringify(state.threads));
  } catch {
    // Storage may be unavailable; the list just won't persist.
  }
  renderThreads();
}

function rememberThread(id, firstInput) {
  if (state.threads.some((thread) => thread.id === id)) return;
  const title = firstInput.length > 48 ? `${firstInput.slice(0, 48)}...` : firstInput;
  state.threads.unshift({ id, title });
  saveThreads();
}

function renderThreads() {
  els.threadList.replaceChildren();
  if (state.threads.length === 0) {
    els.threadList.append(h("li", { class: "muted small thread-empty" }, "No threads yet."));
    return;
  }
  for (const thread of state.threads) {
    const active = thread.id === state.threadId;
    els.threadList.append(
      h(
        "li",
        { class: `thread${active ? " thread-active" : ""}` },
        h(
          "button",
          {
            type: "button",
            class: "thread-open",
            "aria-current": active ? "true" : false,
            title: thread.id,
            onclick: () => openThread(thread.id),
          },
          thread.title || thread.id,
        ),
        h(
          "button",
          {
            type: "button",
            class: "thread-delete",
            "aria-label": `Delete thread ${thread.title || thread.id}`,
            title: "Delete thread",
            onclick: () => deleteThread(thread.id),
          },
          "×",
        ),
      ),
    );
  }
}

function resetConversation() {
  els.messages.replaceChildren(els.emptyState);
  els.emptyState.hidden = false;
  state.awaitingApproval = false;
  updateComposer();
}

function newThread() {
  if (state.busy) return;
  state.threadId = null;
  resetConversation();
  renderThreads();
  els.input.focus();
}

async function deleteThread(id) {
  if (state.busy) return;
  state.threads = state.threads.filter((thread) => thread.id !== id);
  saveThreads();
  fetch(`${API}/threads/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  if (state.threadId === id) newThread();
}

async function openThread(id) {
  if (state.busy || id === state.threadId) return;
  state.threadId = id;
  resetConversation();
  renderThreads();
  if (!state.memoryEnabled) {
    appendNotice("Session memory is off for this agent, so earlier messages are not stored.");
    return;
  }
  try {
    const thread = await getJson(`/threads/${encodeURIComponent(id)}`);
    if (state.threadId !== id) return;
    renderHistory(thread.messages ?? []);
  } catch (error) {
    if (state.threadId !== id) return;
    appendNotice(
      error.status === 404
        ? "No stored history for this thread (it may have been deleted or the app restarted)."
        : `Could not load thread: ${error.message}`,
    );
  }
}

function renderHistory(messages) {
  const toolEls = new Map();
  for (const message of messages) {
    if (message.role === "user") {
      appendUserMessage(toText(message.content));
    } else if (message.role === "assistant") {
      const text = toText(message.content);
      if (text) appendAssistantMessage(text);
      for (const call of message.tool_calls ?? []) {
        const id = call.id ?? call.tool_call_id ?? `history-${toolEls.size}`;
        const tool = createToolView({
          id,
          name: call.name ?? call.function?.name ?? "tool",
          argsText: toText(call.args ?? call.arguments ?? call.function?.arguments ?? ""),
          status: "completed",
        });
        toolEls.set(id, tool);
        els.messages.append(tool.el);
      }
    } else if (message.role === "tool") {
      const tool = toolEls.get(message.tool_call_id);
      if (tool) updateTool(tool, { result: toText(message.content) });
    }
  }
  scrollToBottom(true);
}

// ---------------------------------------------------------------- message rendering

function appendNotice(text) {
  els.emptyState.hidden = true;
  els.messages.append(h("p", { class: "notice muted small" }, text));
}

function appendUserMessage(text) {
  els.emptyState.hidden = true;
  els.messages.append(h("div", { class: "msg msg-user" }, h("div", { class: "msg-body" }, text)));
  scrollToBottom();
}

function appendAssistantMessage(text) {
  els.emptyState.hidden = true;
  const body = h("div", { class: "msg-body" }, text);
  els.messages.append(h("div", { class: "msg msg-assistant" }, body));
  scrollToBottom();
  return body;
}

// ---------------------------------------------------------------- tool cards

const STATUS_LABELS = {
  running: "running",
  completed: "completed",
  error: "error",
  denied: "denied",
  pending_approval: "awaiting approval",
};

/** A tool view keeps its data and re-renders its own <details> element on change. */
function createToolView(initial) {
  const tool = {
    id: initial.id,
    name: "tool",
    argsText: "",
    status: "running",
    open: true,
    el: null,
    ...initial,
  };
  tool.el = renderTool(tool);
  return tool;
}

function updateTool(tool, patch) {
  Object.assign(tool, patch);
  const next = renderTool(tool);
  tool.el.replaceWith(next);
  tool.el = next;
}

function renderTool(tool) {
  const statusClass = `badge badge-status badge-${tool.status}`;
  const details = h(
    "details",
    { class: `tool-card tool-${tool.status}`, open: tool.open },
    h(
      "summary",
      {},
      h("code", { class: "tool-name" }, tool.name),
      h("span", { class: statusClass }, STATUS_LABELS[tool.status] ?? tool.status),
      tool.stubbed
        ? h("span", { class: "badge badge-stub", title: "Result came from a stub" }, "stubbed")
        : null,
      typeof tool.duration_ms === "number"
        ? h("span", { class: "muted small tool-latency" }, formatMs(tool.duration_ms))
        : null,
    ),
    h("div", { class: "tool-body" }, ...toolSections(tool)),
  );
  details.addEventListener("toggle", () => {
    tool.open = details.open;
  });
  return details;
}

function toolSections(tool) {
  const sections = [];
  const args = prettyJson(tool.argsText);
  if (args) sections.push(labelled("Arguments", h("pre", { class: "code" }, args)));
  if (tool.approval)
    sections.push(labelled("Approval", h("span", { class: "small" }, toText(tool.approval))));
  if (tool.result !== undefined && tool.result !== null && tool.result !== "") {
    sections.push(labelled("Result", h("pre", { class: "code" }, prettyJson(tool.result))));
  }
  if (tool.error) {
    const message = typeof tool.error === "string" ? tool.error : (tool.error.message ?? toText(tool.error));
    sections.push(labelled("Error", h("pre", { class: "code code-error" }, message)));
  }
  return sections;
}

function labelled(label, node) {
  return h("div", { class: "field" }, h("div", { class: "field-label" }, label), node);
}

// ---------------------------------------------------------------- run lifecycle

function createRun(input) {
  const footer = h("div", { class: "run-footer", hidden: true });
  const run = {
    id: null,
    input,
    tools: new Map(),
    messages: new Map(),
    usageEvents: [],
    approvals: null,
    startedAt: performance.now(),
    footer,
    errorEl: null,
  };
  els.messages.append(footer);
  return run;
}

/** Insert a node just before the run footer so content stays in event order. */
function appendToRun(run, node) {
  run.footer.before(node);
  scrollToBottom();
}

function getTool(run, id) {
  let tool = run.tools.get(id);
  if (!tool) {
    tool = createToolView({ id });
    run.tools.set(id, tool);
    appendToRun(run, tool.el);
  }
  return tool;
}

function handleEvent(run, event) {
  switch (event.type) {
    case "RUN_STARTED":
      run.id = event.runId ?? run.id;
      if (event.threadId && state.threadId !== event.threadId) {
        state.threadId = event.threadId;
        rememberThread(event.threadId, run.input);
      }
      break;
    case "TEXT_MESSAGE_START": {
      const body = h("div", { class: "msg-body streaming" });
      run.messages.set(event.messageId, body);
      appendToRun(run, h("div", { class: "msg msg-assistant" }, body));
      break;
    }
    case "TEXT_MESSAGE_CONTENT": {
      let body = run.messages.get(event.messageId);
      if (!body) {
        body = h("div", { class: "msg-body streaming" });
        run.messages.set(event.messageId, body);
        appendToRun(run, h("div", { class: "msg msg-assistant" }, body));
      }
      body.append(document.createTextNode(event.delta ?? ""));
      scrollToBottom();
      break;
    }
    case "TEXT_MESSAGE_END":
      run.messages.get(event.messageId)?.classList.remove("streaming");
      break;
    case "TOOL_CALL_START":
      updateTool(getTool(run, event.toolCallId), { name: event.toolCallName ?? "tool", status: "running" });
      break;
    case "TOOL_CALL_ARGS": {
      const tool = getTool(run, event.toolCallId);
      updateTool(tool, { argsText: tool.argsText + (event.delta ?? "") });
      break;
    }
    case "TOOL_CALL_RESULT": {
      const tool = getTool(run, event.toolCallId);
      const status = tool.status === "running" ? "completed" : tool.status;
      updateTool(tool, { result: event.content, status });
      break;
    }
    case "CUSTOM":
      if (event.name === "armature.usage") run.usageEvents.push(event.value ?? {});
      else if (event.name === "armature.approval_required") showApprovals(run, event.value?.approvals ?? []);
      break;
    case "RUN_FINISHED":
      if (event.outcome?.type === "interrupt") handleInterrupt(run, event.outcome.interrupts ?? []);
      break;
    case "RUN_ERROR":
      showRunError(run, { code: event.code, message: event.message });
      break;
    default:
      break;
  }
}

async function consumeStream(run, response) {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  for await (const event of readSse(response)) handleEvent(run, event);
  for (const body of run.messages.values()) body.classList.remove("streaming");
}

async function* readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
    for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
      const event = parseSseBlock(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (event) yield event;
    }
  }
  const tail = parseSseBlock(buffer + decoder.decode());
  if (tail) yield tail;
}

function parseSseBlock(block) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function setBusy(busy) {
  state.busy = busy;
  updateComposer();
}

function updateComposer() {
  const blocked = state.busy || state.awaitingApproval;
  els.send.disabled = blocked;
  els.input.disabled = state.busy;
  els.input.placeholder = state.awaitingApproval
    ? "Approve or deny the pending tool calls to continue this run, or start a new thread."
    : "Message the agent (Enter to send, Shift+Enter for newline)";
}

async function sendMessage(text) {
  const input = text.trim();
  if (!input || state.busy || state.awaitingApproval) return;
  els.input.value = "";
  state.stickToBottom = true;
  appendUserMessage(input);
  const run = createRun(input);
  setBusy(true);
  try {
    const body = { input };
    if (state.threadId) body.thread_id = state.threadId;
    const response = await fetch(`${API}/runs/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    await consumeStream(run, response);
  } catch (error) {
    showRunError(run, { code: "network_error", message: error.message });
  } finally {
    await settleRun(run);
    setBusy(false);
    if (!state.awaitingApproval) els.input.focus();
  }
}

// ---------------------------------------------------------------- approvals

function handleInterrupt(run, interrupts) {
  if (run.approvals && !run.approvals.submitted) return;
  const pending = interrupts
    .map((item) => run.tools.get(item.toolCallId))
    .filter(Boolean)
    .map((tool) => ({
      tool_call_id: tool.id,
      name: tool.name,
      args: safeParse(tool.argsText),
      side_effect: null,
    }));
  if (pending.length > 0) showApprovals(run, pending);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function showApprovals(run, approvals) {
  if (approvals.length === 0) return;
  const decisions = new Map();
  const approvalState = { submitted: false, decisions };
  run.approvals = approvalState;
  for (const approval of approvals) {
    const tool = run.tools.get(approval.tool_call_id);
    if (tool && tool.status !== "pending_approval") updateTool(tool, { status: "pending_approval" });
  }
  state.awaitingApproval = true;
  updateComposer();

  const rows = approvals.map((approval) =>
    approvalRow(approval, decisions, () => maybeResume(run, approvals)),
  );
  const panel = h(
    "section",
    { class: "approvals", "aria-label": "Approval required" },
    h("h3", {}, "Approval required"),
    h(
      "p",
      { class: "muted small" },
      "Decide every pending tool call. The run resumes when all have a decision.",
    ),
    ...rows,
  );
  approvalState.panel = panel;
  appendToRun(run, panel);
}

function approvalRow(approval, decisions, onDecide) {
  const approve = h(
    "button",
    { type: "button", class: "btn btn-small btn-approve", "aria-pressed": "false" },
    "Approve",
  );
  const deny = h(
    "button",
    { type: "button", class: "btn btn-small btn-deny", "aria-pressed": "false" },
    "Deny",
  );
  const decide = (value) => {
    decisions.set(approval.tool_call_id, value);
    approve.setAttribute("aria-pressed", String(value));
    deny.setAttribute("aria-pressed", String(!value));
    onDecide();
  };
  approve.addEventListener("click", () => decide(true));
  deny.addEventListener("click", () => decide(false));
  const row = h(
    "div",
    { class: "approval-row" },
    h(
      "div",
      { class: "approval-info" },
      h("code", { class: "tool-name" }, approval.name),
      approval.side_effect ? sideEffectBadge(approval.side_effect) : null,
      h("pre", { class: "code" }, toText(approval.args)),
    ),
    h("div", { class: "approval-actions" }, approve, deny),
  );
  return row;
}

async function maybeResume(run, approvals) {
  const pending = run.approvals;
  if (!pending || pending.submitted) return;
  if (!approvals.every((approval) => pending.decisions.has(approval.tool_call_id))) return;
  pending.submitted = true;
  pending.panel.classList.add("approvals-done");
  for (const button of pending.panel.querySelectorAll("button")) button.disabled = true;
  pending.panel.append(h("p", { class: "muted small" }, "Decisions sent."));
  state.awaitingApproval = false;
  setBusy(true);
  try {
    const response = await fetch(`${API}/runs/${encodeURIComponent(run.id)}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        decisions: approvals.map((approval) => ({
          tool_call_id: approval.tool_call_id,
          approve: pending.decisions.get(approval.tool_call_id),
        })),
        stream: true,
      }),
    });
    await consumeStream(run, response);
  } catch (error) {
    showRunError(run, { code: "network_error", message: error.message });
  } finally {
    await settleRun(run);
    setBusy(false);
    if (!state.awaitingApproval) els.input.focus();
  }
}

// ---------------------------------------------------------------- errors + summary

function showRunError(run, { code, message }) {
  run.errorEl?.remove();
  run.errorEl = h(
    "section",
    { class: "error-panel", role: "alert" },
    h("strong", {}, "Run failed"),
    code ? h("code", { class: "error-code" }, code) : null,
    h("p", {}, message || "Unknown error"),
  );
  appendToRun(run, run.errorEl);
}

/** After a run settles, fill tool details, usage and latency from GET /runs/{id}. */
async function settleRun(run) {
  let record = null;
  if (run.id) {
    try {
      record = await getJson(`/runs/${encodeURIComponent(run.id)}`);
    } catch {
      // The streamed data is still shown; the readout falls back to it.
    }
  }
  if (record) {
    for (const call of record.tool_calls ?? []) {
      const tool = getTool(run, call.id);
      updateTool(tool, {
        name: call.name ?? tool.name,
        argsText: call.args !== undefined ? toText(call.args) : tool.argsText,
        status: call.status ?? tool.status,
        approval: call.approval,
        stubbed: call.stubbed,
        error: call.error,
        duration_ms: call.duration_ms,
        result: call.result !== undefined && call.result !== null ? toText(call.result) : tool.result,
      });
    }
    if (record.error && !run.errorEl) showRunError(run, record.error);
  }
  renderRunFooter(run, record);
}

function streamedUsage(run) {
  const total = { input_tokens: 0, output_tokens: 0, cost_usd: null };
  for (const usage of run.usageEvents) {
    total.input_tokens += usage.input_tokens ?? 0;
    total.output_tokens += usage.output_tokens ?? 0;
    if (typeof usage.cost_usd === "number") total.cost_usd = (total.cost_usd ?? 0) + usage.cost_usd;
  }
  return total;
}

function renderRunFooter(run, record) {
  const usage = record?.usage ?? streamedUsage(run);
  const latency = record?.duration_ms ?? Math.round(performance.now() - run.startedAt);
  const stat = (label, value) => h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, value));
  run.footer.hidden = false;
  run.footer.replaceChildren(
    h(
      "dl",
      { class: "stats" },
      stat("Status", record?.status ?? "unknown"),
      stat("Latency", formatMs(latency)),
      stat("Tokens", `${usage.input_tokens ?? 0} in / ${usage.output_tokens ?? 0} out`),
      stat("Est. cost", formatCost(usage.cost_usd)),
      usage.model_calls !== undefined ? stat("Model calls", String(usage.model_calls)) : null,
    ),
    run.id ? h("code", { class: "run-id muted small" }, run.id) : null,
  );
  scrollToBottom();
}

// ---------------------------------------------------------------- wiring

els.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(els.input.value);
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
});

els.newThread.addEventListener("click", newThread);

loadAgent();
