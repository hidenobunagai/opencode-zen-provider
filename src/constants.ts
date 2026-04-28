import { version } from "../package.json";

export const BASE_URL = "https://opencode.ai/zen/v1";
export const EXTENSION_VERSION: string = version;

/** Safety margin for context window calculations (in tokens) */
export const CONTEXT_WINDOW_SAFETY_MARGIN = 4096;

/** Default token limit if model info is unknown */
export const DEFAULT_MAX_OUTPUT_TOKENS = 65536;

/** Maximum retry delay in milliseconds */
export const MAX_RETRY_DELAY_MS = 30000;

/** Base retry delay in milliseconds */
export const BASE_RETRY_DELAY_MS = 1000;

/** Max tool result characters for Anthropic API */
export const ANTHROPIC_MAX_TOOL_RESULT_CHARS = 20000;

/** Models that require the reasoning_content workaround */
export const REASONING_CONTENT_WORKAROUND_MODELS = new Set(["kimi-k2.6"]);

/** Map model IDs to tiktoken encoder names */
export const MODEL_TOKENIZER_MAP: Record<string, string> = {
  "big-pickle": "gpt-4o",
  "claude-opus-4-7": "gpt-4o",
  "claude-sonnet-4-6": "gpt-4o",
  "gemini-3-flash": "gpt-4o",
  "gemini-3.1-pro": "gpt-4o",
  "glm-5.1": "gpt-4o",
  "gpt-5.4": "gpt-4o",
  "gpt-5.4-mini": "gpt-4o",
  "gpt-5.4-nano": "gpt-4o",
  "gpt-5.4-pro": "gpt-4o",
  "gpt-5.5": "gpt-4o",
  "gpt-5.5-pro": "gpt-4o",
  "hy3-preview-free": "gpt-4o",
  "kimi-k2.6": "gpt-4o",
  "ling-2.6-flash-free": "gpt-4o",
  "minimax-m2.5": "gpt-4o",
  "minimax-m2.5-free": "gpt-4o",
  "minimax-m2.7": "gpt-4o",
  "nemotron-3-super-free": "gpt-4o",
  "qwen3.6-plus": "gpt-4o",
};
