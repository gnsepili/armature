import { EventSchema } from "@ag-ui/core/schemas";
import type { ArcEvent } from "./client.ts";
import { ApprovalRequiredValue, CUSTOM_EVENTS, UsageValue } from "./types.ts";

/**
 * Checks an ARC event stream against AG-UI schemas and the ARC sequencing rules:
 * one RUN_STARTED first, exactly one terminal event last, balanced text and tool
 * call lifecycles, and well-formed Armature CUSTOM payloads. A resume stream reports
 * results for calls that ended in the paused stream; pass their ids as `endedToolCalls`.
 */
export function validateEventStream(
  events: ArcEvent[],
  opts: { endedToolCalls?: Iterable<string> } = {},
): string[] {
  const errors: string[] = [];
  if (events.length === 0) return ["stream produced no events"];
  events.forEach((event, i) => {
    const parsed = EventSchema.safeParse(event);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push(
        `event #${i} (${String(event.type)}) is not a valid AG-UI event: ${issue?.path.join(".")} ${issue?.message}`,
      );
    }
  });
  if (events[0]!.type !== "RUN_STARTED")
    errors.push(`first event is ${events[0]!.type}, expected RUN_STARTED`);
  const terminal = events.findIndex((e) => e.type === "RUN_FINISHED" || e.type === "RUN_ERROR");
  if (terminal === -1) errors.push("stream ended without RUN_FINISHED or RUN_ERROR");
  else if (terminal !== events.length - 1) errors.push(`events after terminal ${events[terminal]!.type}`);

  const openText = new Set<string>();
  const openTools = new Set<string>();
  const endedTools = new Set<string>(opts.endedToolCalls ?? []);
  for (const [i, e] of events.entries()) {
    const messageId = e.messageId as string | undefined;
    const toolCallId = e.toolCallId as string | undefined;
    switch (e.type) {
      case "TEXT_MESSAGE_START":
        if (openText.has(messageId!)) errors.push(`#${i}: text message ${messageId} started twice`);
        openText.add(messageId!);
        break;
      case "TEXT_MESSAGE_CONTENT":
        if (!openText.has(messageId!)) errors.push(`#${i}: content for unopened text message ${messageId}`);
        break;
      case "TEXT_MESSAGE_END":
        if (!openText.delete(messageId!)) errors.push(`#${i}: end for unopened text message ${messageId}`);
        break;
      case "TOOL_CALL_START":
        if (openTools.has(toolCallId!) || endedTools.has(toolCallId!))
          errors.push(`#${i}: tool call ${toolCallId} started twice`);
        openTools.add(toolCallId!);
        break;
      case "TOOL_CALL_ARGS":
        if (!openTools.has(toolCallId!)) errors.push(`#${i}: args for unopened tool call ${toolCallId}`);
        break;
      case "TOOL_CALL_END":
        if (!openTools.delete(toolCallId!)) errors.push(`#${i}: end for unopened tool call ${toolCallId}`);
        endedTools.add(toolCallId!);
        break;
      case "TOOL_CALL_RESULT":
        if (!endedTools.has(toolCallId!))
          errors.push(`#${i}: result for tool call ${toolCallId} that never ended`);
        break;
      case "CUSTOM": {
        const schema =
          e.name === CUSTOM_EVENTS.usage
            ? UsageValue
            : e.name === CUSTOM_EVENTS.approvalRequired
              ? ApprovalRequiredValue
              : undefined;
        const check = schema?.safeParse(e.value);
        if (check && !check.success)
          errors.push(`#${i}: ${e.name} payload invalid: ${check.error.issues[0]?.message}`);
        break;
      }
    }
  }
  if (events.at(-1)?.type === "RUN_FINISHED") {
    for (const id of openText) errors.push(`text message ${id} never ended`);
    for (const id of openTools) errors.push(`tool call ${id} never ended`);
  }
  return errors;
}

/** Concatenated assistant text from TEXT_MESSAGE_CONTENT deltas. */
export function streamedText(events: ArcEvent[]): string {
  return events
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => e.delta as string)
    .join("");
}
