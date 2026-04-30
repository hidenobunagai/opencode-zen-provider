// tool-repair.ts — context extraction, argument repair, tool call dedup
import * as vscode from "vscode";

interface ToolSchema {
  required?: string[];
  enumValues?: Record<string, string[]>;
}

interface ChatRequestContext {
  filePath?: string;
  startLine?: number;
  endLine?: number;
  cwd?: string;
  userRequest?: string;
}

// --- Pre-compiled regex patterns (module-level, compiled once) ---
const RE_FILE_PATH = /The user's current file is\s+([^\n]+?)\.(?:\s|$)/;
const RE_SELECTION = /The current selection is from line\s+(\d+)\s+to line\s+(\d+)/;
const RE_CWD = /(?:^|\n)Cwd:\s+([^\n]+)/;
const RE_USER_REQUEST = /<userRequest>\s*([\s\S]*?)\s*<\/userRequest>/i;

function inferRunSubagentAgentName(text: string | undefined): string | undefined {
  if (!text) return undefined;

  const agentPattern =
    /(?:[`"'「『])?([A-Za-z][\w &\/-]{0,80}?)(?:[`"'」』])?\s*(?:エージェント|agent|subagent)/gi;
  let match: RegExpExecArray | null;
  let inferred: string | undefined;

  while ((match = agentPattern.exec(text)) !== null) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    inferred = candidate;
  }

  return inferred;
}

export function buildToolCallCanonicalKey(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(args)}`;
}

export function getCompletedToolCallKeys(
  messages: readonly vscode.LanguageModelChatMessage[],
  requestContext: ChatRequestContext | undefined,
  toolSchemas: ReadonlyMap<string, ToolSchema>,
): Set<string> {
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== vscode.LanguageModelChatMessageRole.User) continue;
    const hasNonToolResultContent = message.content.some((part) => {
      const tp = part as { callId?: unknown; content?: unknown[] };
      return !(typeof tp.callId === "string" && Array.isArray(tp.content));
    });
    if (hasNonToolResultContent) {
      startIndex = i + 1;
      break;
    }
  }

  const completedCallIds = new Set<string>();
  for (const message of messages.slice(startIndex)) {
    for (const part of message.content) {
      const tp = part as { callId?: unknown; content?: unknown[] };
      if (typeof tp.callId === "string" && Array.isArray(tp.content)) {
        completedCallIds.add(tp.callId);
      }
    }
  }

  const keys = new Set<string>();
  for (const message of messages.slice(startIndex)) {
    for (const part of message.content) {
      const tc = part as { callId?: unknown; name?: unknown; input?: unknown };
      if (
        typeof tc.callId !== "string" ||
        !completedCallIds.has(tc.callId) ||
        typeof tc.name !== "string"
      ) {
        continue;
      }
      const repairedArgs = repairToolArguments(
        tc.name,
        tc.input ?? {},
        requestContext,
        toolSchemas.get(tc.name),
      );
      keys.add(buildToolCallCanonicalKey(tc.name, repairedArgs));
    }
  }
  return keys;
}

export function getToolSchemaMap(
  options: vscode.ProvideLanguageModelChatResponseOptions,
): Map<string, ToolSchema> {
  const map = new Map<string, ToolSchema>();
  for (const tool of options.tools ?? []) {
    const inputSchema = tool.inputSchema as
      | { required?: unknown; properties?: unknown }
      | undefined;
    const required = Array.isArray(inputSchema?.required)
      ? inputSchema.required.filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        )
      : undefined;
    const enumValues: Record<string, string[]> = {};
    const properties =
      typeof inputSchema?.properties === "object" && inputSchema.properties !== null
        ? (inputSchema.properties as Record<string, unknown>)
        : {};
    for (const [name, value] of Object.entries(properties)) {
      const propSchema =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as { enum?: unknown })
          : undefined;
      if (Array.isArray(propSchema?.enum)) {
        const allowed = propSchema.enum.filter((item): item is string => typeof item === "string");
        if (allowed.length > 0) {
          enumValues[name] = allowed;
        }
      }
    }
    map.set(tool.name, { required, enumValues });
  }
  return map;
}

export function hasRequiredToolArguments(args: unknown, schema: ToolSchema | undefined): boolean {
  return getMissingRequiredToolArguments(args, schema).length === 0;
}

export function getMissingRequiredToolArguments(
  args: unknown,
  schema: ToolSchema | undefined,
): string[] {
  const required = schema?.required ?? [];
  if (required.length === 0) return [];
  if (typeof args !== "object" || args === null || Array.isArray(args)) return [...required];
  const record = args as Record<string, unknown>;
  return required.filter(
    (key) =>
      !(key in record && record[key] !== undefined && record[key] !== null && record[key] !== ""),
  );
}

export function buildInvalidToolCallFallback(
  skippedToolCalls: readonly { name: string; required: string[]; missing: string[] }[],
): string | undefined {
  const skippedWithRequiredArgs = skippedToolCalls.find(
    (tc) => tc.missing.length > 0 || tc.required.length > 0,
  );
  if (!skippedWithRequiredArgs) return undefined;
  const missingArgs = (
    skippedWithRequiredArgs.missing.length > 0
      ? skippedWithRequiredArgs.missing
      : skippedWithRequiredArgs.required
  )
    .map((a) => `\`${a}\``)
    .join(", ");
  return `The model tried to call \`${skippedWithRequiredArgs.name}\` without the required argument(s) ${missingArgs}. Please retry the request and provide those arguments explicitly.`;
}

export function extractChatRequestContext(
  messages: readonly vscode.LanguageModelChatMessage[],
): ChatRequestContext | undefined {
  const context: ChatRequestContext = {};
  // Track which fields we've found to enable early exit
  let foundFile = false;
  let foundCwd = false;
  let foundUserRequest = false;
  let foundSelection = false;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    for (const part of message.content) {
      // Early exit: all 4 fields collected
      if (foundFile && foundCwd && foundUserRequest && foundSelection) break;

      const text =
        part instanceof vscode.LanguageModelTextPart
          ? part.value
          : typeof part === "object" &&
              part !== null &&
              "value" in part &&
              typeof (part as { value?: unknown }).value === "string"
            ? (part as { value: string }).value
            : undefined;
      if (!text) continue;

      const fileMatch = !foundFile ? text.match(RE_FILE_PATH) : undefined;
      const selectionMatch = !foundSelection ? text.match(RE_SELECTION) : undefined;
      const cwdMatch = !foundCwd ? text.match(RE_CWD) : undefined;
      const userRequestMatch = !foundUserRequest ? text.match(RE_USER_REQUEST) : undefined;

      if (fileMatch && !foundFile) {
        foundFile = true;
        context.filePath = fileMatch[1].trim();
      }
      if (cwdMatch && !foundCwd) {
        foundCwd = true;
        context.cwd = cwdMatch[1].trim();
      }
      if (!foundUserRequest) {
        const explicitUserRequest = userRequestMatch?.[1]?.trim();
        if (explicitUserRequest) {
          foundUserRequest = true;
          context.userRequest = explicitUserRequest;
        } else {
          const trimmedText = text.trim();
          if (
            trimmedText &&
            !trimmedText.includes("<attachments>") &&
            !trimmedText.includes("<context>")
          ) {
            foundUserRequest = true;
            context.userRequest = trimmedText;
          }
        }
      }
      if (selectionMatch && !foundSelection) {
        const startLine = Number(selectionMatch[1]);
        const endLine = Number(selectionMatch[2]);
        if (Number.isFinite(startLine) && Number.isFinite(endLine)) {
          foundSelection = true;
          context.startLine = startLine;
          context.endLine = endLine;
        }
      }
    }
    // Early exit: all 4 fields collected
    if (foundFile && foundCwd && foundUserRequest && foundSelection) break;
  }

  return context.filePath ||
    context.cwd ||
    context.userRequest ||
    context.startLine !== undefined ||
    context.endLine !== undefined
    ? context
    : undefined;
}

export function repairToolArguments(
  toolName: string,
  args: unknown,
  requestContext: ChatRequestContext | undefined,
  schema?: ToolSchema,
  assistantText?: string,
): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return args;

  const record = args as Record<string, unknown>;
  const required = new Set(schema?.required ?? []);
  const needsStringField = (value: unknown, field: string): boolean =>
    required.has(field) && (typeof value !== "string" || value.trim().length === 0);
  const needsNumberField = (value: unknown, field: string): boolean =>
    required.has(field) && typeof value !== "number";
  const needsBooleanField = (value: unknown, field: string): boolean =>
    required.has(field) && typeof value !== "boolean";

  const repaired = { ...record };
  const context = requestContext;

  if (needsBooleanField(repaired.isRegexp, "isRegexp")) repaired.isRegexp = false;
  if (needsBooleanField(repaired.includeIgnoredFiles, "includeIgnoredFiles"))
    repaired.includeIgnoredFiles = false;

  // run_in_terminal: required args are command, explanation, goal, mode, timeout.
  // command is the only truly required arg; the rest have safe defaults.
  if (toolName === "run_in_terminal") {
    if (needsStringField(repaired.command, "command")) {
      // Without a command, the tool call is fundamentally invalid — skip repair
      return repaired;
    }
    return {
      ...repaired,
      ...(needsStringField(repaired.explanation, "explanation")
        ? { explanation: "Run command in terminal" }
        : {}),
      ...(needsStringField(repaired.goal, "goal") ? { goal: "Execute command" } : {}),
      ...(needsStringField(repaired.mode, "mode") ? { mode: "sync" } : {}),
      ...(needsNumberField(repaired.timeout, "timeout") ? { timeout: 30000 } : {}),
    };
  }

  if (toolName === "runSubagent") {
    const {
      name: _legacyName,
      input: _legacyInput,
      argument: _legacyArgument,
      argumentHint: _legacyArgumentHint,
      ...subagentArgs
    } = repaired;
    const agentName =
      typeof subagentArgs.agentName === "string" && subagentArgs.agentName.trim().length > 0
        ? subagentArgs.agentName.trim()
        : typeof repaired.name === "string" && repaired.name.trim().length > 0
          ? repaired.name.trim()
          : inferRunSubagentAgentName(assistantText);
    const prompt =
      typeof subagentArgs.prompt === "string" && subagentArgs.prompt.trim().length > 0
        ? subagentArgs.prompt.trim()
        : typeof repaired.input === "string" && repaired.input.trim().length > 0
          ? repaired.input.trim()
          : typeof repaired.argument === "string" && repaired.argument.trim().length > 0
            ? repaired.argument.trim()
            : typeof context?.userRequest === "string" && context.userRequest.trim().length > 0
              ? context.userRequest.trim()
              : undefined;
    const description =
      typeof subagentArgs.description === "string" && subagentArgs.description.trim().length > 0
        ? subagentArgs.description.trim()
        : typeof repaired.argumentHint === "string" && repaired.argumentHint.trim().length > 0
          ? repaired.argumentHint.trim()
          : agentName
            ? `Run ${agentName} subagent`
            : "Run subagent";

    return {
      ...subagentArgs,
      ...(agentName ? { agentName } : {}),
      ...(prompt ? { prompt } : {}),
      ...(description ? { description } : {}),
    };
  }

  if (!context) return repaired;

  if (toolName === "read_file") {
    const legacyPath = typeof repaired.path === "string" ? repaired.path.trim() : "";
    const { path: _unusedPath, ...readFileArgs } = repaired;
    const normalizedReadFileArgs =
      legacyPath &&
      (typeof readFileArgs.filePath !== "string" || readFileArgs.filePath.trim().length === 0)
        ? { ...readFileArgs, filePath: legacyPath }
        : readFileArgs;
    const explicitFilePath =
      typeof normalizedReadFileArgs.filePath === "string" &&
      normalizedReadFileArgs.filePath.trim().length > 0
        ? normalizedReadFileArgs.filePath
        : undefined;
    const inferredFilePath =
      explicitFilePath ??
      context?.filePath ??
      vscode.window.activeTextEditor?.document.uri.fsPath ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const shouldUseContextRange =
      !explicitFilePath || !context.filePath || explicitFilePath === context.filePath;
    return {
      ...normalizedReadFileArgs,
      ...(needsStringField(normalizedReadFileArgs.filePath, "filePath") && inferredFilePath
        ? { filePath: inferredFilePath }
        : {}),
      ...(needsNumberField(normalizedReadFileArgs.startLine, "startLine")
        ? { startLine: shouldUseContextRange ? (context.startLine ?? 1) : 1 }
        : {}),
      ...(needsNumberField(normalizedReadFileArgs.endLine, "endLine")
        ? { endLine: shouldUseContextRange ? (context.endLine ?? 200) : 200 }
        : {}),
    };
  }

  if (toolName === "list_dir") {
    return {
      ...repaired,
      ...(needsStringField(repaired.path, "path") && context.cwd ? { path: context.cwd } : {}),
    };
  }

  return repaired;
}

export function isToolCallInput(args: unknown): args is Record<string, unknown> {
  return typeof args === "object" && args !== null && !Array.isArray(args);
}

export type { ChatRequestContext, ToolSchema };
