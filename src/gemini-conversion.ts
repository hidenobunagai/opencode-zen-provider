import * as vscode from "vscode";
import {
  JsonObject,
  OcGoChatMessage,
  OcGoContentPart,
  OcGoGeminiContent,
  OcGoGeminiFunctionDeclaration,
  OcGoGeminiPart,
  OcGoGeminiRequest,
  OcGoGeminiTextPart,
} from "./types";

function asJsonObject(value: unknown): JsonObject | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function parseFunctionArgs(argumentsJson: string): JsonObject {
  try {
    return asJsonObject(JSON.parse(argumentsJson)) ?? {};
  } catch {
    return {};
  }
}

function parseToolResponse(content: string | OcGoContentPart[]): JsonObject {
  if (typeof content === "string") {
    try {
      return asJsonObject(JSON.parse(content)) ?? { content };
    } catch {
      return { content };
    }
  }
  return { content: JSON.stringify(content) };
}

function dataUrlToInlineData(url: string): { mimeType: string; data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  if (!match) {
    return undefined;
  }
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function convertContentParts(content: string | OcGoContentPart[]): OcGoGeminiPart[] {
  if (typeof content === "string") {
    return content ? [{ text: content }] : [];
  }

  return content.flatMap((part): OcGoGeminiPart[] => {
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
      return [{ text: part.text }];
    }
    if (part.type === "image_url" && typeof part.image_url?.url === "string") {
      const inlineData = dataUrlToInlineData(part.image_url.url);
      if (inlineData) {
        return [{ inlineData }];
      }
    }
    return [];
  });
}

function getSystemInstruction(
  messages: readonly OcGoChatMessage[],
): OcGoGeminiTextPart[] | undefined {
  const parts = messages.flatMap((message): OcGoGeminiTextPart[] => {
    if (message.role !== "system") {
      return [];
    }
    return convertContentParts(message.content).flatMap((part) =>
      "text" in part && typeof part.text === "string" ? [{ text: part.text }] : [],
    );
  });

  return parts.length > 0 ? parts : undefined;
}

function buildFunctionNameById(messages: readonly OcGoChatMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const toolCall of message.tool_calls ?? []) {
      names.set(toolCall.id, toolCall.function.name);
    }
  }
  return names;
}

function appendContent(
  contents: OcGoGeminiContent[],
  role: OcGoGeminiContent["role"],
  parts: OcGoGeminiPart[],
): void {
  if (parts.length === 0) {
    return;
  }

  const lastContent = contents.at(-1);
  if (lastContent?.role === role) {
    lastContent.parts.push(...parts);
    return;
  }

  contents.push({ role, parts });
}

function buildContents(messages: readonly OcGoChatMessage[]): OcGoGeminiContent[] {
  const functionNameById = buildFunctionNameById(messages);
  const contents: OcGoGeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "tool" && message.tool_call_id) {
      appendContent(contents, "user", [
        {
          functionResponse: {
            id: message.tool_call_id,
            name: functionNameById.get(message.tool_call_id) ?? "unknown",
            response: parseToolResponse(message.content),
          },
        },
      ]);
      continue;
    }

    const parts = convertContentParts(message.content);
    if (message.role === "assistant") {
      parts.push(
        ...(message.tool_calls ?? []).map((toolCall) => ({
          functionCall: {
            id: toolCall.id,
            name: toolCall.function.name,
            args: parseFunctionArgs(toolCall.function.arguments),
          },
        })),
      );
    }

    if (parts.length === 0) {
      continue;
    }

    appendContent(contents, message.role === "assistant" ? "model" : "user", parts);
  }

  return contents;
}

function getGeminiTools(options: vscode.ProvideLanguageModelChatResponseOptions) {
  const toolsInput = options.tools ?? [];
  if (toolsInput.length === 0) {
    return {};
  }

  const functionDeclarations: OcGoGeminiFunctionDeclaration[] = toolsInput.map((tool) => ({
    name: tool.name,
    description:
      typeof tool.description === "string" ? tool.description.trim() || undefined : undefined,
    parameters: tool.inputSchema as JsonObject,
  }));

  const requiredToolMode = (
    vscode as unknown as {
      LanguageModelChatToolMode?: { Required?: number };
    }
  ).LanguageModelChatToolMode?.Required;

  const toolConfig =
    requiredToolMode !== undefined && options.toolMode === requiredToolMode
      ? {
          functionCallingConfig: {
            mode: "ANY" as const,
            allowedFunctionNames: functionDeclarations.map((tool) => tool.name),
          },
        }
      : undefined;

  return {
    tools: [{ functionDeclarations }],
    toolConfig,
  };
}

export function buildGeminiRequest(
  messages: readonly OcGoChatMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  generationConfig: NonNullable<OcGoGeminiRequest["generationConfig"]>,
): OcGoGeminiRequest {
  const request: OcGoGeminiRequest = {
    contents: buildContents(messages),
    generationConfig,
  };

  const systemInstruction = getSystemInstruction(messages);
  if (systemInstruction) {
    request.systemInstruction = {
      role: "system",
      parts: systemInstruction,
    };
  }

  const { tools, toolConfig } = getGeminiTools(options);
  if (tools) {
    request.tools = tools;
  }
  if (toolConfig) {
    request.toolConfig = toolConfig;
  }

  return request;
}
