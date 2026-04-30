import { version } from "../package.json";

export const BASE_URL = "https://opencode.ai/zen/v1";
export const EXTENSION_VERSION: string = version;

/** Safety margin ratio for context window calculations (3% of context window) */
export const CONTEXT_WINDOW_SAFETY_MARGIN_RATIO = 0.03;
export const CONTEXT_WINDOW_SAFETY_MARGIN_MIN = 1024;
export const CONTEXT_WINDOW_SAFETY_MARGIN_MAX = 8192;

export function calculateSafetyMargin(contextWindow: number): number {
  const margin = Math.round(contextWindow * CONTEXT_WINDOW_SAFETY_MARGIN_RATIO);
  return Math.max(
    CONTEXT_WINDOW_SAFETY_MARGIN_MIN,
    Math.min(CONTEXT_WINDOW_SAFETY_MARGIN_MAX, margin),
  );
}

/** Default token limit if model info is unknown */
export const DEFAULT_MAX_OUTPUT_TOKENS = 65536;

/** Maximum retry delay in milliseconds */
export const MAX_RETRY_DELAY_MS = 30000;

/** Base retry delay in milliseconds */
export const BASE_RETRY_DELAY_MS = 1000;

/** Max tool result characters for Anthropic API */
export const ANTHROPIC_MAX_TOOL_RESULT_CHARS = 20000;

/** Timeout for individual SSE chunk reads (milliseconds). Prevents indefinite hang when the server stops sending data. */
export const SSE_CHUNK_TIMEOUT_MS = 60000;

/** Tokens per image for vision models (conservative estimate for 512x512+ with detail: auto) */
export const TOKENS_PER_IMAGE = 1000;

/** Default tiktoken encoder model used for all token estimation */
export const DEFAULT_TIKTOKEN_MODEL = "gpt-4o";

/** Characters per token for the character-based fallback (general models) */
export const DEFAULT_CHARS_PER_TOKEN = 2.0;

/**
 * CJK-optimized models need a lower chars-per-token ratio because CJK characters
 * consume roughly 1-2 tokens each in BPE tokenizers, compared to ~0.25 for English.
 * A ratio of 0.8 gives ~125 estimated tokens per 100 CJK chars (actual: ~150).
 */
export const CJK_MODEL_PREFIXES = ["kimi", "qwen", "glm", "hy3", "ling"];
export const CJK_CHARS_PER_TOKEN = 0.8;

/**
 * Reasoning/thinking model IDs that emit internal "thinking" tokens as part of
 * their output stream. Sending an explicit max_tokens to these models causes
 * them to consume the entire budget on reasoning, leaving zero visible output.
 * These models must be called WITHOUT max_tokens — they self-regulate output.
 */
export const REASONING_MODEL_IDS = new Set([
  "kimi-k2.6",
]);
