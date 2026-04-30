import * as vscode from "vscode";
import {
  CJK_CHARS_PER_TOKEN,
  CJK_MODEL_PREFIXES,
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_TIKTOKEN_MODEL,
  TOKENS_PER_IMAGE,
} from "./constants";
import { getDataPartTextValue, getTextPartValue, extractImageData, type LegacyPart } from "./message-parts";
import { debugLog } from "./output-channel";

type Encoding = {
  encode(text: string): { length: number } | number[] | Uint32Array;
  free(): void;
};

type TiktokenModule = {
  encoding_for_model(model: string): Encoding;
};

let cachedTiktokenModule: TiktokenModule | null | undefined;

function getTiktokenModule(): TiktokenModule | null {
  if (cachedTiktokenModule !== undefined) {
    return cachedTiktokenModule;
  }

  try {
    cachedTiktokenModule = require("@dqbd/tiktoken") as TiktokenModule;
  } catch (error) {
    cachedTiktokenModule = null;
    debugLog("tiktoken", error);
  }

  return cachedTiktokenModule;
}

function getModelCharsPerToken(modelId?: string): number {
  if (!modelId) return DEFAULT_CHARS_PER_TOKEN;
  if (CJK_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix))) {
    return CJK_CHARS_PER_TOKEN;
  }
  return DEFAULT_CHARS_PER_TOKEN;
}

/**
 * tiktoken encoders are optimized for OpenAI tokenizers and are inaccurate
 * for CJK-heavy models. For CJK-prefixed models we skip tiktoken entirely
 * and use character-based estimation, which is both faster and more accurate.
 */
function isCjkModel(modelId?: string): boolean {
  if (!modelId) return false;
  return CJK_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

/**
 * Map model families to the closest-supported tiktoken encoder.
 * tiktoken only ships OpenAI encoders; for non-OpenAI models we use
 * `gpt-4o` (o200k_base) as the best available approximation.
 */
function getTiktokenModelForModelId(modelId?: string): string {
  if (!modelId) return DEFAULT_TIKTOKEN_MODEL;
  // OpenAI GPT family: use gpt-4o (o200k_base)
  if (modelId.startsWith("gpt-")) return DEFAULT_TIKTOKEN_MODEL;
  // All other models: gpt-4o is the closest available approximation
  return DEFAULT_TIKTOKEN_MODEL;
}

export function estimateTokens(text: string, modelId?: string): number {
  if (!text) return 0;
  // CJK models: skip tiktoken (inaccurate) and use char-based fallback directly
  if (isCjkModel(modelId)) {
    return Math.ceil(text.length / getModelCharsPerToken(modelId));
  }
  try {
    const tiktoken = getTiktokenModule();
    if (!tiktoken) {
      throw new Error("@dqbd/tiktoken unavailable");
    }
    const tiktokenModel = getTiktokenModelForModelId(modelId);
    const encoding = tiktoken.encoding_for_model(tiktokenModel);
    const tokens = encoding.encode(text).length;
    encoding.free();
    return tokens;
  } catch {
    return Math.ceil(text.length / getModelCharsPerToken(modelId));
  }
}

export function estimateMessagesTokens(
  messages: readonly { content: (vscode.LanguageModelInputPart | LegacyPart)[] }[],
  modelId?: string,
): number {
  let total = 0;
  for (const message of messages) {
    for (const part of message.content) {
      // Image parts: add fixed token estimate per image
      if (extractImageData(part)) {
        total += TOKENS_PER_IMAGE;
        continue;
      }
      const textValue = getTextPartValue(part) ?? getDataPartTextValue(part);
      if (textValue !== undefined) {
        total += estimateTokens(textValue, modelId);
      }
    }
  }
  return total;
}
