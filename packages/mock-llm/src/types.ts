/** Wire types for the subset of the OpenAI Chat Completions API the mock implements. */

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string }> | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters?: JsonSchema };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  response_format?: { type: string; json_schema?: { schema?: JsonSchema } };
}

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  minimum?: number;
  [key: string]: unknown;
};

/** One scripted assistant turn. */
export type ScriptStep =
  | { text: string }
  | { tool_calls: Array<{ name: string; args?: Record<string, unknown>; id?: string }> }
  | { error: { status: number; message: string } };

export interface Script {
  /** Exact text of the first user message the script answers. */
  match: string;
  steps: ScriptStep[];
  /** Added before each step is served; useful for timeout tests. */
  delay_ms?: number;
}

export type MockMode = "smoke" | "null";

export interface LoggedRequest {
  at: number;
  model: string;
  stream: boolean;
  messages: ChatMessage[];
  tools: string[];
  served: "script" | "smoke" | "null";
  step?: number;
}
