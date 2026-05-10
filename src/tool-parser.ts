// tool-parser.ts — parse text-embedded and XML-style tool calls from model output

// --- Pre-compiled regex patterns ---
const RE_PARSEABLE_JSON_VALUE = /^[\[{"]/;
const RE_JSON_PRIMITIVE = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/;
const RE_XML_ATTRIBUTE = /\b([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;
const RE_LOOSE_XML_TAG = /<([A-Za-z_][\w-]*)"?>([\s\S]*?)<\/\1>/g;
const RE_TOOL_SEP_TOKEN = /<(arg_key|arg_value)>([\s\S]*?)<\/(?:arg_key|arg_value)>/g;
const RE_TOOL_PARAMETER = /<tool_parameter\s+name="([^"]+)">([\s\S]*?)<\/tool_parameter>/g;
const RE_TOOL_CALLS_END = /^\s*<\/tool_calls>/;
const RE_OPENING_FENCE = /^```(?:json)?\r?\n/i;
const RE_CLOSING_FENCE = /\r?\n```/;
const RE_COMPACT_TOOL_NAME = /^\s*([^\s<>="'\/]+)/;
const RE_XML_NAME_ATTR = /\bname\s*=\s*"([^"]+)"/;
const RE_COMPACT_INNER = /^\s*([^\s<>="'\/]+)([\s\S]*)$/;

// Combined regex to find the earliest start token in a single pass
const RE_START_TOKENS = /<\|tool_call_begin\|>|<tool_calls?>|<tool_call\s|```json|```\r?\n[\{\[]/;

// --- Types ---
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
  if (RE_PARSEABLE_JSON_VALUE.test(trimmed) || RE_JSON_PRIMITIVE.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  return trimmed;
}

function extractXmlStyleAttributes(text: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  RE_XML_ATTRIBUTE.lastIndex = 0;
  let attributeMatch: RegExpExecArray | null;
  while ((attributeMatch = RE_XML_ATTRIBUTE.exec(text)) !== null) {
    const attributeName = attributeMatch[1]?.trim();
    if (!attributeName || attributeName === "name") continue;
    args[attributeName] = parseEmbeddedToolParameterValue(attributeMatch[2] ?? "");
  }
  return args;
}

function extractLooseXmlStyleParameters(text: string): Record<string, unknown> {
  const normalizedText = text.replace(/<tool_call>(?=[A-Za-z_][\w-]*"?\s*>)/g, "<");
  const args = extractXmlStyleAttributes(normalizedText);
  RE_LOOSE_XML_TAG.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = RE_LOOSE_XML_TAG.exec(normalizedText)) !== null) {
    const parameterName = tagMatch[1]?.trim();
    if (!parameterName) continue;
    args[parameterName] = parseEmbeddedToolParameterValue(tagMatch[2] ?? "");
  }
  return args;
}

function extractToolSepStyleParameters(text: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  RE_TOOL_SEP_TOKEN.lastIndex = 0;
  let tokenMatch: RegExpExecArray | null;
  let pendingKey: string | undefined;

  while ((tokenMatch = RE_TOOL_SEP_TOKEN.exec(text)) !== null) {
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
  const slice = text.slice(cursor);
  const match = slice.match(/^\s*/);
  return cursor + (match ? match[0].length : 0);
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
    .match(RE_COMPACT_TOOL_NAME)?.[1]
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

  let resolvedToolName = openTag.match(RE_XML_NAME_ATTR)?.[1]?.trim();
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
    RE_TOOL_PARAMETER.lastIndex = 0;
    let parameterMatch: RegExpExecArray | null;
    while ((parameterMatch = RE_TOOL_PARAMETER.exec(innerContent)) !== null) {
      const parameterName = parameterMatch[1]?.trim();
      if (!parameterName) continue;
      args[parameterName] = parseEmbeddedToolParameterValue(parameterMatch[2] ?? "");
    }
    Object.assign(args, extractLooseXmlStyleParameters(innerContent));

    const compactInnerMatch = innerContent.match(RE_COMPACT_INNER);
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

  let cursor = 0;
  let wrapped = false;

  if (text.startsWith(toolCallsStartToken)) {
    wrapped = true;
    cursor = toolCallsStartToken.length;
    const wsMatch = text.slice(cursor).match(/^\s*/);
    cursor += wsMatch ? wsMatch[0].length : 0;
  }

  const singleToolCall = parseSingleXmlStyleToolCall(text.slice(cursor));
  if (singleToolCall.incomplete) {
    return { consumed: 0, incomplete: true };
  }

  let consumed = cursor + singleToolCall.consumed;
  if (wrapped) {
    const wrapperCloseMatch = text.slice(consumed).match(RE_TOOL_CALLS_END);
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
  const openingFenceMatch = text.match(RE_OPENING_FENCE);
  if (!openingFenceMatch) {
    return { consumed: 0, incomplete: true };
  }

  const bodyStart = openingFenceMatch[0].length;
  const closingFenceMatch = text.slice(bodyStart).match(RE_CLOSING_FENCE);
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
    // Single regex pass to find the earliest start token
    const tokenMatch = RE_START_TOKENS.exec(remaining);
    const nextStartIndex = tokenMatch ? tokenMatch.index : -1;
    let nextStartKind: "legacy" | "xml" | "json" | undefined;
    if (tokenMatch) {
      const m = tokenMatch[0];
      if (m === beginToken) nextStartKind = "legacy";
      else if (m.startsWith("<tool_call")) nextStartKind = "xml";
      else nextStartKind = "json";
    }

    if (nextStartKind === undefined) {
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

    appendText(remaining.slice(0, nextStartIndex));
    remaining = remaining.slice(nextStartIndex);

    if (nextStartKind === "xml") {
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

    if (nextStartKind === "json") {
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

    if (nextStartKind === "legacy") {
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
  }

  return { segments, incompleteText };
}

// ---------------------------------------------------------------------------
// Stateful scanner for streaming text-embedded tool calls.
// Avoids re-scanning the entire accumulated buffer on every text delta.
// Each delta is processed incrementally — incomplete content is kept in an
// internal buffer and retried when the next delta arrives.
// ---------------------------------------------------------------------------

export class ToolCallScanner {
  private readonly beginToken = "<|tool_call_begin|>";
  private readonly argBeginToken = "<|tool_call_argument_begin|>";
  private readonly endToken = "<|tool_call_end|>";
  private readonly xmlStartTokens = ["<tool_calls>", "<tool_call ", "<tool_call>"] as const;
  private readonly jsonStartFragments = [
    "```json",
    "```\n[",
    "```\n{",
    "```\r\n[",
    "```\r\n{",
  ] as const;

  /** Accumulated unprocessed or partial content. */
  buffer = "";

  /**
   * Feed a new text delta into the scanner.
   * Returns fully-parsed segments.  Incomplete content is kept in {@link buffer}
   * and will be retried when the next delta arrives.
   */
  feed(text: string): ParsedTextSegment[] {
    this.buffer += text;

    const delimTokens = [this.beginToken, ...this.xmlStartTokens, ...this.jsonStartFragments];

    const segments: ParsedTextSegment[] = [];
    let pos = 0;

    const appendText = (value: string): void => {
      if (!value) return;
      const lastSegment = segments.at(-1);
      if (lastSegment?.type === "text") {
        lastSegment.text += value;
        return;
      }
      segments.push({ type: "text", text: value });
    };

    while (pos < this.buffer.length) {
      // Find the earliest delimiter in the remaining buffer
      let earliestIdx = -1;
      let earliestKind: "legacy" | "xml" | "json" = "legacy";

      const legacyIdx = this.buffer.indexOf(this.beginToken, pos);
      if (legacyIdx !== -1) {
        earliestIdx = legacyIdx;
        earliestKind = "legacy";
      }
      for (const token of this.xmlStartTokens) {
        const idx = this.buffer.indexOf(token, pos);
        if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
          earliestIdx = idx;
          earliestKind = "xml";
        }
      }
      for (const token of this.jsonStartFragments) {
        const idx = this.buffer.indexOf(token, pos);
        if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
          earliestIdx = idx;
          earliestKind = "json";
        }
      }

      if (earliestIdx === -1) {
        // No delimiter found.  Check for partial delimiter at the very end.
        const partialStart = findTrailingTokenPrefixStartAny(this.buffer.slice(pos), delimTokens);
        if (partialStart === -1) {
          // All remaining content is plain text — emit it and clear buffer
          appendText(this.buffer.slice(pos));
          pos = this.buffer.length;
        } else {
          // Partial delimiter — keep in buffer for next delta
          appendText(this.buffer.slice(pos, pos + partialStart));
          this.buffer = this.buffer.slice(pos + partialStart);
          return segments;
        }
        break;
      }

      // Emit text before the delimiter
      appendText(this.buffer.slice(pos, earliestIdx));
      pos = earliestIdx;

      if (earliestKind === "xml") {
        const xmlResult = parseXmlStyleToolCall(this.buffer.slice(pos));
        if (xmlResult.incomplete) {
          // Incomplete XML — keep from pos onward for next delta
          this.buffer = this.buffer.slice(pos);
          return segments;
        }
        pos += xmlResult.consumed;
        if (xmlResult.rawText) {
          appendText(xmlResult.rawText);
        } else if (xmlResult.toolCalls) {
          for (const toolCall of xmlResult.toolCalls) {
            segments.push({ type: "toolCall", toolCall });
          }
        } else if (xmlResult.toolCall) {
          segments.push({ type: "toolCall", toolCall: xmlResult.toolCall });
        }
        continue;
      }

      if (earliestKind === "json") {
        const jsonResult = parseJsonStyleToolCall(this.buffer.slice(pos));
        if (jsonResult.incomplete) {
          this.buffer = this.buffer.slice(pos);
          return segments;
        }
        pos += jsonResult.consumed;
        if (jsonResult.rawText) {
          appendText(jsonResult.rawText);
        } else if (jsonResult.toolCalls) {
          for (const toolCall of jsonResult.toolCalls) {
            segments.push({ type: "toolCall", toolCall });
          }
        }
        continue;
      }

      // Legacy format: <|tool_call_begin|> name <|tool_call_argument_begin|> args <|tool_call_end|>
      pos += this.beginToken.length;
      const argBeginIdx = this.buffer.indexOf(this.argBeginToken, pos);
      const endIdx = this.buffer.indexOf(this.endToken, pos);
      if (argBeginIdx === -1 || endIdx === -1 || argBeginIdx > endIdx) {
        // Incomplete — keep from the beginToken position
        this.buffer = this.buffer.slice(earliestIdx);
        return segments;
      }

      const name = this.buffer.slice(pos, argBeginIdx).trim();
      pos = endIdx + this.endToken.length;

      if (!name) continue;

      const argsText = this.buffer.slice(argBeginIdx + this.argBeginToken.length, endIdx).trim();
      try {
        segments.push({
          type: "toolCall",
          toolCall: { name, args: argsText ? JSON.parse(argsText) : {} },
        });
      } catch {
        appendText(`${this.beginToken}${name}${this.argBeginToken}${argsText}${this.endToken}`);
      }
    }

    // All content consumed — reset buffer
    this.buffer = "";
    return segments;
  }

  /** Flush any remaining buffered content as plain text. */
  flushText(): string {
    const text = this.buffer;
    this.buffer = "";
    return text;
  }
}

export type { ParsedTextSegment, ParsedTextToolCall, ParsedTextToolCallResult };
