// tool-parser.ts — parse text-embedded and XML-style tool calls from model output

interface ParsedTextToolCall {
  name: string;
  args: unknown;
}

interface ParsedTextSegmentText {
  type: "text";
  text: string;
}

interface ParsedTextSegmentToolCall {
  type: "toolCall";
  toolCall: ParsedTextToolCall;
}

type ParsedTextSegment = ParsedTextSegmentText | ParsedTextSegmentToolCall;

interface ParsedTextToolCallResult {
  segments: ParsedTextSegment[];
  incompleteText: string;
}

interface ParsedXmlStyleToolCallResult {
  consumed: number;
  incomplete: boolean;
  rawText?: string;
  toolCall?: ParsedTextToolCall;
  toolCalls?: ParsedTextToolCall[];
}

interface ParsedJsonStyleToolCallResult {
  consumed: number;
  incomplete: boolean;
  rawText?: string;
  toolCalls?: ParsedTextToolCall[];
}

export function findTrailingTokenPrefixStart(text: string, token: string): number {
  const maxPrefixLength = Math.min(text.length, token.length - 1);
  for (let prefixLength = maxPrefixLength; prefixLength > 0; prefixLength -= 1) {
    if (text.endsWith(token.slice(0, prefixLength))) {
      return text.length - prefixLength;
    }
  }
  return -1;
}

export function findTrailingTokenPrefixStartAny(text: string, tokens: readonly string[]): number {
  let earliestStart = -1;
  for (const token of tokens) {
    const start = findTrailingTokenPrefixStart(text, token);
    if (start !== -1 && (earliestStart === -1 || start < earliestStart)) {
      earliestStart = start;
    }
  }
  return earliestStart;
}

function parseEmbeddedToolParameterValue(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  if (
    /^[\[{\"]/.test(trimmed) ||
    /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(trimmed)
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  return trimmed;
}

function extractXmlStyleAttributes(text: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const attributePattern = /\b([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;
  let attributeMatch: RegExpExecArray | null;
  while ((attributeMatch = attributePattern.exec(text)) !== null) {
    const attributeName = attributeMatch[1]?.trim();
    if (!attributeName || attributeName === "name") continue;
    args[attributeName] = parseEmbeddedToolParameterValue(attributeMatch[2] ?? "");
  }
  return args;
}

function extractLooseXmlStyleParameters(text: string): Record<string, unknown> {
  const normalizedText = text.replace(/<tool_call>(?=[A-Za-z_][\w-]*"?\s*>)/g, "<");
  const args = extractXmlStyleAttributes(normalizedText);
  const tagPattern = /<([A-Za-z_][\w-]*)"?>([\s\S]*?)<\/\1>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(normalizedText)) !== null) {
    const parameterName = tagMatch[1]?.trim();
    if (!parameterName) continue;
    args[parameterName] = parseEmbeddedToolParameterValue(tagMatch[2] ?? "");
  }
  return args;
}

function extractToolSepStyleParameters(text: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const tokenPattern = /<(arg_key|arg_value)>([\s\S]*?)<\/(?:arg_key|arg_value)>/g;
  let tokenMatch: RegExpExecArray | null;
  let pendingKey: string | undefined;

  while ((tokenMatch = tokenPattern.exec(text)) !== null) {
    const tokenType = tokenMatch[1];
    const tokenValue = tokenMatch[2] ?? "";

    if (!pendingKey) {
      if (tokenType !== "arg_key") continue;
      const candidateKey = tokenValue.trim();
      if (!candidateKey) continue;
      pendingKey = candidateKey;
      continue;
    }

    args[pendingKey] = parseEmbeddedToolParameterValue(tokenValue);
    pendingKey = undefined;
  }

  return args;
}

function skipWhitespace(text: string, cursor: number): number {
  let nextCursor = cursor;
  while (nextCursor < text.length && /\s/.test(text[nextCursor])) {
    nextCursor += 1;
  }
  return nextCursor;
}

function findEarliestTokenIndex(text: string, start: number, tokens: readonly string[]): number {
  let earliestIndex = -1;
  for (const token of tokens) {
    const index = text.indexOf(token, start);
    if (index !== -1 && (earliestIndex === -1 || index < earliestIndex)) {
      earliestIndex = index;
    }
  }
  return earliestIndex;
}

function parseNestedToolCallMarkers(text: string): ParsedXmlStyleToolCallResult | undefined {
  const toolCallsStartToken = "<tool_calls>";
  const toolCallToken = "<tool_call>";
  const toolCallEndToken = "</tool_call>";
  const toolCallsEndToken = "</tool_calls>";

  let cursor = 0;
  if (text.startsWith(toolCallsStartToken)) {
    cursor = toolCallsStartToken.length;
  }
  cursor = skipWhitespace(text, cursor);
  if (!text.startsWith(toolCallToken, cursor)) {
    return undefined;
  }

  cursor += toolCallToken.length;
  cursor = skipWhitespace(text, cursor);

  const firstNestedOpen = text.indexOf(toolCallToken, cursor);
  const firstClose = text.indexOf(toolCallEndToken, cursor);
  if (firstNestedOpen === -1 || firstClose === -1 || firstNestedOpen > firstClose) {
    return undefined;
  }

  const toolName = text.slice(cursor, firstNestedOpen).trim();
  if (!toolName) {
    return undefined;
  }

  cursor = firstNestedOpen;
  const args: Record<string, unknown> = {};
  let parsedField = false;

  while (cursor < text.length) {
    cursor = skipWhitespace(text, cursor);

    while (text.startsWith(toolCallEndToken, cursor)) {
      cursor += toolCallEndToken.length;
      cursor = skipWhitespace(text, cursor);
    }

    if (text.startsWith(toolCallsEndToken, cursor)) {
      cursor += toolCallsEndToken.length;
      break;
    }

    if (!text.startsWith(toolCallToken, cursor)) {
      break;
    }

    cursor += toolCallToken.length;
    cursor = skipWhitespace(text, cursor);

    const valueStart = text.indexOf(toolCallToken, cursor);
    const nextEnd = findEarliestTokenIndex(text, cursor, [toolCallEndToken, toolCallsEndToken]);
    if (valueStart === -1 || (nextEnd !== -1 && valueStart > nextEnd)) {
      return undefined;
    }

    const fieldName = text.slice(cursor, valueStart).trim();
    if (!fieldName) {
      return undefined;
    }

    cursor = valueStart + toolCallToken.length;
    const valueEnd = text.indexOf(toolCallEndToken, cursor);
    if (valueEnd === -1) {
      return { consumed: 0, incomplete: true };
    }

    args[fieldName] = parseEmbeddedToolParameterValue(text.slice(cursor, valueEnd));
    parsedField = true;
    cursor = valueEnd + toolCallEndToken.length;
  }

  if (!parsedField) {
    return undefined;
  }

  cursor = skipWhitespace(text, cursor);
  while (text.startsWith(toolCallEndToken, cursor)) {
    cursor += toolCallEndToken.length;
    cursor = skipWhitespace(text, cursor);
  }
  if (text.startsWith(toolCallsEndToken, cursor)) {
    cursor += toolCallsEndToken.length;
  }

  return { consumed: cursor, incomplete: false, toolCall: { name: toolName, args } };
}

function parseSingleXmlStyleToolCall(text: string): ParsedXmlStyleToolCallResult {
  const toolCallStartTokens = ["<tool_call ", "<tool_call>"] as const;
  const toolCallEndToken = "</tool_call>";

  const toolCallStartToken = toolCallStartTokens.find((token) => text.startsWith(token));
  if (!toolCallStartToken) {
    return { consumed: 0, incomplete: true };
  }

  const openTagEnd = text.indexOf(">", toolCallStartToken.length - 1);
  if (openTagEnd === -1) {
    return { consumed: 0, incomplete: true };
  }

  const openTag = text.slice(0, openTagEnd + 1);
  let closeTagIndex = text.indexOf(toolCallEndToken, openTagEnd + 1);
  let closingTagLength = toolCallEndToken.length;
  const potentialCompactToolName = text
    .slice(openTagEnd + 1)
    .match(/^\s*([^\s<>="'\/]+)/)?.[1]
    ?.trim();
  if (closeTagIndex === -1 && potentialCompactToolName) {
    const namedCloseTag = `</${potentialCompactToolName}>`;
    const namedCloseTagIndex = text.indexOf(namedCloseTag, openTagEnd + 1);
    if (namedCloseTagIndex !== -1) {
      closeTagIndex = namedCloseTagIndex;
      closingTagLength = namedCloseTag.length;
    }
  }
  if (closeTagIndex === -1) {
    return { consumed: 0, incomplete: true };
  }

  const consumed = closeTagIndex + closingTagLength;
  const innerContent = text.slice(openTagEnd + 1, closeTagIndex);
  const args: Record<string, unknown> = extractXmlStyleAttributes(openTag);

  let resolvedToolName = openTag.match(/\bname\s*=\s*"([^"]+)"/)?.[1]?.trim();
  const toolSepToken = "<tool_sep>";
  const toolSepIndex = innerContent.indexOf(toolSepToken);

  if (toolSepIndex !== -1) {
    const toolSepToolName = innerContent.slice(0, toolSepIndex).trim();
    if (toolSepToolName) {
      resolvedToolName ||= toolSepToolName;
    }
    Object.assign(
      args,
      extractToolSepStyleParameters(innerContent.slice(toolSepIndex + toolSepToken.length)),
    );
  } else {
    const parameterPattern = /<tool_parameter\s+name="([^"]+)">([\s\S]*?)<\/tool_parameter>/g;
    let parameterMatch: RegExpExecArray | null;
    while ((parameterMatch = parameterPattern.exec(innerContent)) !== null) {
      const parameterName = parameterMatch[1]?.trim();
      if (!parameterName) continue;
      args[parameterName] = parseEmbeddedToolParameterValue(parameterMatch[2] ?? "");
    }
    Object.assign(args, extractLooseXmlStyleParameters(innerContent));

    const compactInnerMatch = innerContent.match(/^\s*([^\s<>="'\/]+)([\s\S]*)$/);
    const compactToolName = compactInnerMatch?.[1]?.trim();
    const compactArgs = compactInnerMatch?.[2]
      ? extractLooseXmlStyleParameters(compactInnerMatch[2])
      : undefined;
    if (compactArgs) {
      Object.assign(args, compactArgs);
    }

    resolvedToolName ||= compactToolName;
  }

  if (!resolvedToolName) {
    return { consumed, incomplete: false, rawText: text.slice(0, consumed) };
  }

  return { consumed, incomplete: false, toolCall: { name: resolvedToolName, args } };
}

function parseWrappedXmlStyleToolCalls(text: string): ParsedXmlStyleToolCallResult | undefined {
  const toolCallsStartToken = "<tool_calls>";
  const toolCallsEndToken = "</tool_calls>";
  const toolCallStartTokens = ["<tool_call ", "<tool_call>"] as const;

  if (!text.startsWith(toolCallsStartToken)) {
    return undefined;
  }

  const wrapperEndIndex = text.indexOf(toolCallsEndToken, toolCallsStartToken.length);
  if (wrapperEndIndex === -1) {
    return undefined;
  }

  let cursor = toolCallsStartToken.length;
  const toolCalls: ParsedTextToolCall[] = [];

  while (cursor < wrapperEndIndex) {
    cursor = skipWhitespace(text, cursor);
    if (cursor >= wrapperEndIndex) {
      break;
    }

    const remaining = text.slice(cursor, wrapperEndIndex);
    if (!toolCallStartTokens.some((token) => remaining.startsWith(token))) {
      const consumed = wrapperEndIndex + toolCallsEndToken.length;
      return { consumed, incomplete: false, rawText: text.slice(0, consumed) };
    }

    const parsedToolCall = parseSingleXmlStyleToolCall(remaining);
    if (parsedToolCall.incomplete) {
      return { consumed: 0, incomplete: true };
    }
    if (!parsedToolCall.toolCall) {
      const consumed = wrapperEndIndex + toolCallsEndToken.length;
      return { consumed, incomplete: false, rawText: text.slice(0, consumed) };
    }

    toolCalls.push(parsedToolCall.toolCall);
    cursor += parsedToolCall.consumed;
  }

  const consumed = wrapperEndIndex + toolCallsEndToken.length;
  if (toolCalls.length === 0) {
    return { consumed, incomplete: false, rawText: text.slice(0, consumed) };
  }

  return { consumed, incomplete: false, toolCalls };
}

export function parseXmlStyleToolCall(text: string): ParsedXmlStyleToolCallResult {
  const nestedToolCall = parseNestedToolCallMarkers(text);
  if (nestedToolCall) {
    return nestedToolCall;
  }

  const wrappedToolCalls = parseWrappedXmlStyleToolCalls(text);
  if (wrappedToolCalls) {
    return wrappedToolCalls;
  }

  const toolCallsStartToken = "<tool_calls>";
  const toolCallEndToken = "</tool_call>";
  const toolCallsEndPattern = /^\s*<\/tool_calls>/;

  let cursor = 0;
  let wrapped = false;

  if (text.startsWith(toolCallsStartToken)) {
    wrapped = true;
    cursor = toolCallsStartToken.length;
    while (cursor < text.length && /\s/.test(text[cursor])) {
      cursor += 1;
    }
  }

  const singleToolCall = parseSingleXmlStyleToolCall(text.slice(cursor));
  if (singleToolCall.incomplete) {
    return { consumed: 0, incomplete: true };
  }

  let consumed = cursor + singleToolCall.consumed;
  if (wrapped) {
    const wrapperCloseMatch = text.slice(consumed).match(toolCallsEndPattern);
    if (
      !wrapperCloseMatch &&
      text.slice(consumed - toolCallEndToken.length, consumed) === toolCallEndToken
    ) {
      return { consumed: 0, incomplete: true };
    }
    if (wrapperCloseMatch) {
      consumed += wrapperCloseMatch[0].length;
    }
  }

  if (singleToolCall.rawText) {
    return { consumed, incomplete: false, rawText: text.slice(cursor, consumed) };
  }

  return { consumed, incomplete: false, toolCall: singleToolCall.toolCall };
}

function parseJsonStyleToolCallEntry(value: unknown): ParsedTextToolCall | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const name =
    typeof record.tool === "string"
      ? record.tool.trim()
      : typeof record.name === "string"
        ? record.name.trim()
        : "";
  if (!name) {
    return undefined;
  }

  if ("parameters" in record) {
    return { name, args: record.parameters };
  }
  if ("args" in record) {
    return { name, args: record.args };
  }

  const legacyArgs = Object.fromEntries(
    Object.entries(record).filter(([key, fieldValue]) => {
      if (key === "tool" || key === "name") return false;
      return fieldValue !== undefined;
    }),
  );
  if (Object.keys(legacyArgs).length > 0) {
    return { name, args: legacyArgs };
  }

  return undefined;
}

function extractJsonStyleToolCalls(value: unknown): ParsedTextToolCall[] | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const toolCalls = value
      .map((entry) => parseJsonStyleToolCallEntry(entry))
      .filter((entry): entry is ParsedTextToolCall => Boolean(entry));
    return toolCalls.length === value.length ? toolCalls : undefined;
  }

  const toolCall = parseJsonStyleToolCallEntry(value);
  return toolCall ? [toolCall] : undefined;
}

export function parseJsonStyleToolCall(text: string): ParsedJsonStyleToolCallResult {
  const openingFenceMatch = text.match(/^```(?:json)?\r?\n/i);
  if (!openingFenceMatch) {
    return { consumed: 0, incomplete: true };
  }

  const bodyStart = openingFenceMatch[0].length;
  const closingFenceMatch = text.slice(bodyStart).match(/\r?\n```/);
  if (!closingFenceMatch || closingFenceMatch.index === undefined) {
    return { consumed: 0, incomplete: true };
  }

  const closingFenceIndex = bodyStart + closingFenceMatch.index;
  const consumed = closingFenceIndex + closingFenceMatch[0].length;
  const rawText = text.slice(0, consumed);
  const jsonText = text.slice(bodyStart, closingFenceIndex).trim();
  if (!jsonText) {
    return { consumed, incomplete: false, rawText };
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const toolCalls = extractJsonStyleToolCalls(parsed);
    if (toolCalls && toolCalls.length > 0) {
      return { consumed, incomplete: false, toolCalls };
    }
  } catch {}

  return { consumed, incomplete: false, rawText };
}

export function parseTextEmbeddedToolCalls(text: string): ParsedTextToolCallResult {
  const beginToken = "<|tool_call_begin|>";
  const argBeginToken = "<|tool_call_argument_begin|>";
  const endToken = "<|tool_call_end|>";
  const xmlStartTokens = ["<tool_calls>", "<tool_call ", "<tool_call>"] as const;
  const jsonStartTokens = ["```json", "```\n[", "```\n{", "```\r\n[", "```\r\n{"] as const;

  const segments: ParsedTextSegment[] = [];
  let remaining = text;
  let incompleteText = "";

  const appendText = (value: string): void => {
    if (!value) return;
    const lastSegment = segments.at(-1);
    if (lastSegment?.type === "text") {
      lastSegment.text += value;
      return;
    }
    segments.push({ type: "text", text: value });
  };

  while (remaining.length > 0) {
    const candidateStarts = [
      { kind: "legacy" as const, index: remaining.indexOf(beginToken) },
      ...xmlStartTokens.map((token) => ({ kind: "xml" as const, index: remaining.indexOf(token) })),
      ...jsonStartTokens.map((token) => ({
        kind: "json" as const,
        index: remaining.indexOf(token),
      })),
    ].filter((candidate) => candidate.index !== -1);

    const nextStart = candidateStarts.reduce<
      { kind: "legacy" | "xml" | "json"; index: number } | undefined
    >((earliest, candidate) => {
      if (!earliest || candidate.index < earliest.index) return candidate;
      return earliest;
    }, undefined);

    if (!nextStart) {
      const partialStart = findTrailingTokenPrefixStartAny(remaining, [
        beginToken,
        ...xmlStartTokens,
        ...jsonStartTokens,
      ]);
      if (partialStart === -1) {
        appendText(remaining);
      } else {
        appendText(remaining.slice(0, partialStart));
        incompleteText = remaining.slice(partialStart);
      }
      break;
    }

    appendText(remaining.slice(0, nextStart.index));
    remaining = remaining.slice(nextStart.index);

    if (nextStart.kind === "xml") {
      const xmlToolCall = parseXmlStyleToolCall(remaining);
      if (xmlToolCall.incomplete) {
        incompleteText = remaining;
        break;
      }
      remaining = remaining.slice(xmlToolCall.consumed);
      if (xmlToolCall.rawText) {
        appendText(xmlToolCall.rawText);
      } else if (xmlToolCall.toolCalls) {
        for (const toolCall of xmlToolCall.toolCalls) {
          segments.push({ type: "toolCall", toolCall });
        }
      } else if (xmlToolCall.toolCall) {
        segments.push({ type: "toolCall", toolCall: xmlToolCall.toolCall });
      }
      continue;
    }

    if (nextStart.kind === "json") {
      const jsonToolCall = parseJsonStyleToolCall(remaining);
      if (jsonToolCall.incomplete) {
        incompleteText = remaining;
        break;
      }
      remaining = remaining.slice(jsonToolCall.consumed);
      if (jsonToolCall.rawText) {
        appendText(jsonToolCall.rawText);
      } else if (jsonToolCall.toolCalls) {
        for (const toolCall of jsonToolCall.toolCalls) {
          segments.push({ type: "toolCall", toolCall });
        }
      }
      continue;
    }

    remaining = remaining.slice(beginToken.length);
    const argBeginIndex = remaining.indexOf(argBeginToken);
    const endIndex = remaining.indexOf(endToken);
    if (argBeginIndex === -1 || endIndex === -1 || argBeginIndex > endIndex) {
      incompleteText = beginToken + remaining;
      break;
    }

    const name = remaining.slice(0, argBeginIndex).trim();
    const argsText = remaining.slice(argBeginIndex + argBeginToken.length, endIndex).trim();
    remaining = remaining.slice(endIndex + endToken.length);

    if (!name) continue;

    try {
      segments.push({
        type: "toolCall",
        toolCall: { name, args: argsText ? JSON.parse(argsText) : {} },
      });
    } catch {
      appendText(`${beginToken}${name}${argBeginToken}${argsText}${endToken}`);
    }
  }

  return { segments, incompleteText };
}

export type { ParsedTextSegment, ParsedTextToolCall, ParsedTextToolCallResult };
