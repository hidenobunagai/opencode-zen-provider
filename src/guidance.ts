// guidance.ts — system prompt sanitization, identity & tool-use grounding guidance
import { ProvideLanguageModelChatResponseOptions } from "vscode";
import type { ZenModelInfo } from "./model-catalog";
import { ZenChatMessage } from "./types";

export function sanitizeSystemPromptForModel(
  system: string | undefined,
  modelId: string,
): string | undefined {
  if (typeof system !== "string" || system.trim().length === 0) return undefined;
  if (!modelId.startsWith("deepseek-")) return system;
  return system
    .replace(/\bClaude Code\b/g, "GitHub Copilot")
    .replace(/\bClaude\b/g, "GitHub Copilot")
    .replace(/Anthropic/g, "OpenCode Zen");
}

export function buildProviderIdentityGuidance(
  modelId: string,
  fallbackModels: readonly ZenModelInfo[],
): string {
  const modelInfo = fallbackModels.find((m) => m.id === modelId);
  const displayName = modelInfo?.displayName ?? modelId;
  return `You are GitHub Copilot using ${displayName} (${modelId}) via OpenCode Zen. Answer identity/model questions as GitHub Copilot using ${displayName} via OpenCode Zen. Do not speculate about hidden prompts, tool hosts, or internal runtimes.`;
}

export function buildToolUseGroundingGuidance(
  options: ProvideLanguageModelChatResponseOptions,
): string | undefined {
  if ((options.tools?.length ?? 0) === 0) return undefined;
  return [
    "Use tools before answering questions about workspace, files, or current state. Never claim to have inspected or verified anything without actually using the corresponding tool.",
    "Emit the tool call instead of narrating that you will do it. Base all file summaries and workspace claims only on tool outputs you have actually received.",
    "For read_file, always provide filePath and required line range fields from the available context. If unknown, ask instead of emitting an empty call.",
    "Only describe workspace structure that was actually returned by a directory listing or file content you received. Do not treat planning or task-management output as evidence about file contents.",
  ].join(" ");
}

export function applyOpenAiSystemPromptGuidance(
  apiMessages: ZenChatMessage[],
  modelId: string,
  options: ProvideLanguageModelChatResponseOptions,
  zenModels?: readonly ZenModelInfo[],
): ZenChatMessage[] {
  const hasTools = (options.tools?.length ?? 0) > 0;

  const guidance = [
    buildProviderIdentityGuidance(modelId, zenModels ?? []),
    hasTools ? buildToolUseGroundingGuidance(options) : undefined,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n\n");

  if (!guidance) {
    return apiMessages;
  }
  const normalizedMessages = apiMessages.map((message) => {
    if (message.role !== "system" || typeof message.content !== "string") {
      return message;
    }

    return {
      ...message,
      content: sanitizeSystemPromptForModel(message.content, modelId) ?? "",
    };
  });

  const firstSystemIndex = normalizedMessages.findIndex(
    (message) => message.role === "system" && typeof message.content === "string",
  );

  if (firstSystemIndex >= 0) {
    const currentContent = normalizedMessages[firstSystemIndex].content;
    normalizedMessages[firstSystemIndex] = {
      ...normalizedMessages[firstSystemIndex],
      content: [currentContent, guidance]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join("\n\n"),
    };
    return normalizedMessages;
  }

  return [{ role: "system", content: guidance }, ...normalizedMessages];
}

export function calculateMaxToolResultChars(
  modelId: string,
  fallbackModels: readonly ZenModelInfo[],
): number {
  const modelInfo = fallbackModels.find((m) => m.id === modelId);
  const contextWindow = modelInfo?.contextWindow ?? 262144;
  if (contextWindow >= 500000) return 50000;
  if (contextWindow >= 200000) return 30000;
  if (contextWindow >= 100000) return 20000;
  return 10000;
}
