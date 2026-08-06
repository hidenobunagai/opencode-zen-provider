import { version } from "../package.json";

export const BASE_URL = "https://opencode.ai/zen/v1";
export const EXTENSION_VERSION: string = version;

/** Safety margin ratio for context window calculations (1% of context window) */
export const CONTEXT_WINDOW_SAFETY_MARGIN_RATIO = 0.01;
export const CONTEXT_WINDOW_SAFETY_MARGIN_MIN = 2048;
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

/** Timeout for individual SSE chunk reads (milliseconds). Prevents indefinite hang when the server stops sending data. */
export const SSE_CHUNK_TIMEOUT_MS = 60000;

/** Maximum number of retries when a streaming response stops mid-generation */
export const MAX_STREAM_RETRIES = 3;

/** Request timeout in milliseconds */
export const REQUEST_TIMEOUT_MS = 60000;

/**
 * Explicit model IDs that require the reasoning_content workaround.
 */
const REASONING_CONTENT_WORKAROUND_STATIC_SET = new Set([
  "kimi-k2.6",
  "kimi-k2.7-code",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
]);

/**
 * Models that internally reason even though they do not need the
 * reasoning_content workaround (e.g. Responses API models). They still
 * consume part of the output budget on reasoning, so they get the same
 * minimum output budget floor as workaround models.
 */
const THINKING_MODEL_STATIC_SET = new Set(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]);

/** Models that require the reasoning_content workaround */
export const REASONING_CONTENT_WORKAROUND_MODELS = {
  has(modelId: string): boolean {
    if (REASONING_CONTENT_WORKAROUND_STATIC_SET.has(modelId)) {
      return true;
    }
    if (modelId.startsWith("kimi-")) {
      return !modelId.includes("k2.5");
    }
    if (modelId.startsWith("deepseek-")) {
      const match = modelId.match(/deepseek-v(\d+)/);
      if (match) {
        const version = parseInt(match[1], 10);
        return version >= 4;
      }
      return modelId.includes("-r1") || modelId.includes("-r2");
    }
    return false;
  },
};

/** Models with internal reasoning that need a minimum output budget */
export const THINKING_MODELS = {
  has(modelId: string): boolean {
    return (
      THINKING_MODEL_STATIC_SET.has(modelId) || REASONING_CONTENT_WORKAROUND_MODELS.has(modelId)
    );
  },
};

/** Minimum output token budget for reasoning/thinking models when max_tokens is omitted.
 * This is used as a safety floor in context window calculations to ensure
 * the model has enough headroom after input tokens. */
export const REASONING_MODEL_MIN_OUTPUT_BUDGET = 16384;
