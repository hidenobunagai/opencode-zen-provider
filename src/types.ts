export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface ZenContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ZenChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ZenContentPart[];
  name?: string;
  tool_calls?: ZenToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ZenToolCall {
  id: string;
  index?: number;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ZenTool {
  type: "function";
  function: { name: string; description?: string; parameters?: JsonObject };
}

export interface ZenChatRequest {
  model: string;
  messages: ZenChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  stop?: string | string[];
  tools?: ZenTool[];
  tool_choice?: "auto" | "none" | "required" | { type: string; function: { name: string } };
  reasoning_effort?: string;
}

export interface ZenStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: ZenToolCall[];
  };
  finish_reason: string | null;
}

export interface ZenStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ZenStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ZenChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ============================================================================
// Anthropic Messages API types
// ============================================================================

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: JsonObject }
  | { type: "tool_result"; tool_use_id: string; content: string | AnthropicContentBlock[] };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
  reasoning_content?: string;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: JsonObject;
}

export interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: "text"; text: string }>;
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: "auto" | "any" | { type: "tool"; name: string };
}

export interface AnthropicMessageStartEvent {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export interface AnthropicContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: AnthropicContentBlock;
}

export interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string }
    | { type: "thinking_delta"; thinking: string };
}

export interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: { stop_reason: string | null; stop_sequence: string | null };
  usage: { output_tokens: number };
}

export interface AnthropicMessageStopEvent {
  type: "message_stop";
}

export type AnthropicSSEEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent;
