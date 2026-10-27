import * as vscode from "vscode";
import {
  extractImageData,
  getDataPartTextValue,
  getTextPartValue,
  getToolCallInfo,
  getToolResultEntries,
  type LegacyPart,
} from "./message-parts";

/**
 * CJK and full-width characters.  Modern tokenizers typically encode these at
 * roughly one token per character (or more), so they must not be estimated at
 * the Latin-text rate of ~2 chars per token — doing so undercounts
 * Japanese/Chinese/Korean input by about half and can let over-limit requests
 * slip through to the API.
 */
const CJK_CHAR_PATTERN =
  /[\u1100-\u11FF\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFF60\uFFE0-\uFFE6]/;

/**
 * Estimate tokens for a piece of text.
 * - CJK / full-width characters count as ~1 token each.
 * - All other characters count as ~1/2 token each (the historical behavior of
 *   this estimator for Latin-heavy text).
 */
export function estimateTokens(text: string, modelId?: string): number {
  void modelId;
  if (!text) return 0;
  let cjkCount = 0;
  let otherCount = 0;
  for (const ch of text) {
    if (CJK_CHAR_PATTERN.test(ch)) {
      cjkCount += 1;
    } else {
      otherCount += 1;
    }
  }
  return cjkCount + Math.ceil(otherCount / 2);
}

export function estimateMessagesTokens(
  messages: readonly { content: (vscode.LanguageModelInputPart | LegacyPart)[] }[],
  modelId?: string,
): number {
  let total = 0;

  for (const message of messages) {
    if (!message || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      const textValue = getTextPartValue(part) ?? getDataPartTextValue(part);
      if (textValue !== undefined) {
        total += estimateTokens(textValue, modelId);
        continue;
      }

      const toolCall = getToolCallInfo(part);
      if (toolCall) {
        if (toolCall.name) {
          total += estimateTokens(toolCall.name, modelId);
        }
        if (toolCall.args !== undefined) {
          try {
            total += estimateTokens(JSON.stringify(toolCall.args), modelId);
          } catch {
            // Ignore serialization failure
          }
        }
        continue;
      }

      const toolResults = getToolResultEntries([part]);
      if (toolResults.length > 0) {
        for (const entry of toolResults) {
          if (entry.content) {
            total += estimateTokens(entry.content, modelId);
          }
        }
        continue;
      }

      if (extractImageData(part)) {
        total += 1000;
        continue;
      }
    }
  }

  return total;
}
