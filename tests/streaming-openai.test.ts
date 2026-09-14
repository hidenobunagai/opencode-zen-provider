import * as vscode from "vscode";
import { resolveApiEndpoint, streamChatCompletion } from "../src/api";
import { reasoningCache, convertMessages } from "../src/openai-conversion";
import { processOpenAIStream, type OpenAIModelInfo } from "../src/streaming/openai";
import type { ZenStreamResponse } from "../src/types";

jest.mock("../src/api", () => ({
  streamChatCompletion: jest.fn(),
  resolveApiEndpoint: jest.fn(() => "https://opencode.ai/zen/v1/chat/completions"),
}));

jest.mock("vscode", () => ({
  ...jest.requireActual("../__mocks__/vscode"),
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  CancellationError: class CancellationError extends Error {},
  // tool-repair reads these when repairing read_file arguments; the real editor
  // always provides them, so the mock must too.
  window: { activeTextEditor: undefined },
  workspace: { workspaceFolders: undefined },
}));

const streamMock = streamChatCompletion as unknown as jest.Mock;
const resolveApiEndpointMock = resolveApiEndpoint as unknown as jest.Mock;

const READ_FILE_TOOL = {
  name: "read_file",
  description: "Read a file",
  inputSchema: {
    type: "object",
    properties: { filePath: { type: "string" } },
    required: ["filePath"],
  },
};

/** No required arguments, so an argument-less buffered call is still valid. */
const LIST_DIR_TOOL = {
  name: "list_dir",
  description: "List a directory",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
};

/** A tool call delta as the API splits it across chunks. */
function toolCallChunk(
  toolCall: Record<string, unknown>,
  extraChoice: Record<string, unknown> = {},
) {
  return {
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...toolCall }] }, ...extraChoice }],
  };
}

function textChunk(content: string, finishReason?: string) {
  return {
    choices: [
      { index: 0, delta: { content }, ...(finishReason ? { finish_reason: finishReason } : {}) },
    ],
  };
}

function reasoningChunk(reasoningContent: string) {
  return { choices: [{ index: 0, delta: { reasoning_content: reasoningContent } }] };
}

/** A fresh generator per call: retries must not read a consumed stream. */
function streamOf(...chunks: unknown[]): AsyncGenerator<ZenStreamResponse> {
  return (async function* () {
    for (const chunk of chunks) yield chunk as ZenStreamResponse;
  })();
}

/**
 * Queues one stream per attempt and records the `reasoning_effort` each attempt
 * actually sent: the request body is a single mutated object, so reading it
 * from `mock.calls` afterwards only shows the last attempt's value.
 */
function streamAttempts(attempts: Array<() => AsyncGenerator<ZenStreamResponse>>): unknown[] {
  const sentEfforts: unknown[] = [];
  for (const attempt of attempts) {
    streamMock.mockImplementationOnce((_key: string, body: any) => {
      sentEfforts.push(body.reasoning_effort);
      return attempt();
    });
  }
  return sentEfforts;
}

/** Yields the given chunks, then rejects — to exercise the stream error paths. */
function failingStream(error: Error, ...chunks: unknown[]): AsyncGenerator<ZenStreamResponse> {
  return (async function* () {
    for (const chunk of chunks) yield chunk as ZenStreamResponse;
    throw error;
  })();
}

const USER_MESSAGE = { role: 1, content: [{ value: "Hi" }] } as any;

function toolOptions(...tools: unknown[]) {
  return { tools } as any;
}

let progress: { report: jest.Mock };

interface RunOverrides {
  model?: Partial<OpenAIModelInfo>;
  options?: Record<string, unknown>;
  requestedMaxTokens?: number;
  reasoningEffort?: string;
  token?: { isCancellationRequested: boolean; onCancellationRequested: jest.Mock };
}

function run(overrides: RunOverrides = {}): Promise<void> {
  const model: OpenAIModelInfo = { id: "glm-5.2", maxOutputTokens: 65536, ...overrides.model };
  const options = overrides.options ?? {};
  return processOpenAIStream(
    model,
    [USER_MESSAGE],
    options as any,
    options as any,
    "test-key",
    overrides.requestedMaxTokens ?? 4096,
    0,
    [],
    "test-ua",
    progress as any,
    (overrides.token ?? {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    }) as any,
    { signal: undefined } as any,
    overrides.reasoningEffort,
  );
}

function bodyOf(callIndex = 0): any {
  return streamMock.mock.calls[callIndex][1];
}

function reportedText(): string {
  return progress.report.mock.calls
    .map((call) => call[0])
    .filter((part) => part instanceof vscode.LanguageModelTextPart)
    .map((part) => (part as vscode.LanguageModelTextPart).value)
    .join("");
}

function reportedToolCalls(): vscode.LanguageModelToolCallPart[] {
  return progress.report.mock.calls
    .map((call) => call[0])
    .filter(
      (part): part is vscode.LanguageModelToolCallPart =>
        part instanceof vscode.LanguageModelToolCallPart,
    );
}

beforeEach(() => {
  jest.clearAllMocks();
  resolveApiEndpointMock.mockReturnValue("https://opencode.ai/zen/v1/chat/completions");
  reasoningCache.clear();
  progress = { report: jest.fn() };
});

describe("processOpenAIStream — request construction", () => {
  it("sends max_tokens and temperature for a model without the reasoning workaround", async () => {
    streamMock.mockImplementation(() => streamOf(textChunk("ok")));

    await run();

    const body = bodyOf();
    expect(body.model).toBe("glm-5.2");
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(4096);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(reportedText()).toBe("ok");
  });

  it("sends max_completion_tokens with the 16K floor for a reasoning model", async () => {
    streamMock.mockImplementation(() => streamOf(textChunk("ok")));

    await run({ model: { id: "deepseek-v4-pro", maxOutputTokens: 65536 } });

    const body = bodyOf();
    expect(body.max_completion_tokens).toBe(16384);
    expect(body.max_tokens).toBeUndefined();
  });

  it("normalizes a max effort to xhigh on the first attempt", async () => {
    streamMock.mockImplementation(() => streamOf(textChunk("ok")));

    await run({ reasoningEffort: "max" });

    expect(bodyOf().reasoning_effort).toBe("xhigh");
  });

  it("steps the effort down on a retry", async () => {
    // Attempt 0 stops mid tool call, so the stream layer retries.
    const unfinished = toolCallChunk({
      id: "call_1",
      function: { name: "read_file", arguments: '{"filePath":"a.ts"' },
    });
    const sentEfforts = streamAttempts([
      () => streamOf(unfinished),
      () => streamOf(textChunk("second pass")),
    ]);

    await run({ options: toolOptions(READ_FILE_TOOL), reasoningEffort: "xhigh" });

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(sentEfforts).toEqual(["xhigh", "high"]);
    expect(reportedText()).toBe("second pass");
  });

  it("keeps an unknown reasoning effort unchanged on a retry", async () => {
    const unfinished = toolCallChunk({
      id: "call_1",
      function: { name: "read_file", arguments: '{"filePath":"a.ts"' },
    });
    const sentEfforts = streamAttempts([
      () => streamOf(unfinished),
      () => streamOf(textChunk("second pass")),
    ]);

    await run({ options: toolOptions(READ_FILE_TOOL), reasoningEffort: "banana" });

    expect(sentEfforts).toEqual(["banana", "banana"]);
  });

  it("sends the tool schema with a required tool_choice", async () => {
    streamMock.mockImplementation(() => streamOf(textChunk("ok")));

    await run({ options: { tools: [READ_FILE_TOOL], toolMode: 2 } });

    const body = bodyOf();
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({ type: "function", function: { name: "read_file" } });
    expect(body.tool_choice).toBe("required");
  });

  it("throws a CancellationError before fetching when the token is cancelled", async () => {
    await expect(
      run({ token: { isCancellationRequested: true, onCancellationRequested: jest.fn() } }),
    ).rejects.toBeInstanceOf(vscode.CancellationError);
    expect(streamMock).not.toHaveBeenCalled();
  });
});

describe("processOpenAIStream — chunk handling", () => {
  it("assembles a tool call whose arguments contain an escaped backslash", async () => {
    streamMock.mockImplementation(() =>
      streamOf(
        textChunk("Let me read that. "),
        toolCallChunk({
          id: "call_1",
          function: { name: "read_file", arguments: '{"filePath":"src\\\\a.ts"}' },
        }),
      ),
    );

    await run({ options: toolOptions(READ_FILE_TOOL) });

    const calls = reportedToolCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].callId).toBe("call_1");
    expect(calls[0].input).toEqual({ filePath: "src\\a.ts" });
    expect(reportedText()).toBe("Let me read that. ");
  });

  it("emits a tool call whose arguments arrive in pieces", async () => {
    streamMock.mockImplementation(() =>
      streamOf(
        toolCallChunk({
          id: "call_1",
          function: { name: "read_file", arguments: '{"filePath":' },
        }),
        toolCallChunk({ function: { arguments: '"a.ts"}' } }),
      ),
    );

    await run({ options: toolOptions(READ_FILE_TOOL) });

    const calls = reportedToolCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({ filePath: "a.ts" });
  });

  it("reports the visible text once when the stream also carried reasoning", async () => {
    streamMock.mockImplementation(() =>
      streamOf(reasoningChunk("weighing options"), textChunk("answer", "stop")),
    );

    await run();

    // The reasoning-only notice must not be appended to a real answer.
    expect(reportedText()).toBe("answer");
  });

  it("caches the reasoning under the turn's whole visible text", async () => {
    streamMock.mockImplementation(() =>
      streamOf(reasoningChunk("weighing options"), textChunk("answer", "stop")),
    );

    await run({ model: { id: "deepseek-v4-pro" } });

    // convertMessages looks the cache up by the assistant's raw text, so the
    // key must be every reported chunk, not the last one still buffered.
    expect(reasoningCache.get("answer")).toBe("weighing options");
  });

  it("restores the cached reasoning in the next turn's assistant history", async () => {
    streamMock.mockImplementation(() =>
      streamOf(reasoningChunk("weighing options"), textChunk("answer", "stop")),
    );

    await run({ model: { id: "deepseek-v4-pro" } });

    const nextTurn = convertMessages([
      { role: 2, content: [new vscode.LanguageModelTextPart("answer")] },
    ] as any);
    expect(nextTurn[0].reasoning_content).toBe("weighing options");
  });

  it("reports the invalid-tool-call fallback for a text-embedded call missing a required argument", async () => {
    streamMock.mockImplementation(() =>
      streamOf(textChunk('<tool_call>read_file other="x"</tool_call>')),
    );

    await run({ options: toolOptions(READ_FILE_TOOL) });

    expect(reportedToolCalls()).toHaveLength(0);
    expect(reportedText()).toContain("filePath");
  });

  it("retries a stream whose buffered tool call arguments are not JSON, then gives up silently", async () => {
    // "{oops}" is brace-balanced, so it reaches JSON.parse and fails there.
    const unbalanced = toolCallChunk({
      id: "call_1",
      function: { name: "read_file", arguments: "{oops}" },
    });
    streamMock.mockImplementation(() => streamOf(unbalanced));

    await run({ options: toolOptions(READ_FILE_TOOL) });

    expect(streamMock).toHaveBeenCalledTimes(3);
    expect(reportedToolCalls()).toHaveLength(0);
    // Nothing was reported, not even a fallback: the user gets an empty turn.
    expect(progress.report).not.toHaveBeenCalled();
  });

  it("emits a buffered argument-less tool call at stream end when the schema requires nothing", async () => {
    streamMock.mockImplementation(() =>
      streamOf(toolCallChunk({ id: "call_1", function: { name: "list_dir" } })),
    );

    await run({ options: toolOptions(LIST_DIR_TOOL) });

    const calls = reportedToolCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("list_dir");
    expect(calls[0].input).toEqual({});
  });

  it("reports the fallback on the last attempt for a buffered call that needs arguments", async () => {
    const argumentLess = toolCallChunk({ id: "call_1", function: { name: "read_file" } });
    streamMock.mockImplementation(() => streamOf(argumentLess));

    await run({ options: toolOptions(READ_FILE_TOOL) });

    expect(streamMock).toHaveBeenCalledTimes(3);
    expect(reportedToolCalls()).toHaveLength(0);
    expect(reportedText()).toContain("filePath");
  });
});

describe("processOpenAIStream — action announcements", () => {
  it("nudges the model when it announces an action without a tool call", async () => {
    streamMock
      .mockImplementationOnce(() => streamOf(textChunk("テストを実行します。", "stop")))
      .mockImplementationOnce(() =>
        streamOf(
          toolCallChunk({
            id: "call_1",
            function: { name: "read_file", arguments: '{"filePath":"a.ts"}' },
          }),
        ),
      );

    await run({ options: toolOptions(READ_FILE_TOOL) });

    expect(streamMock).toHaveBeenCalledTimes(2);
    const retryMessages = bodyOf(1).messages;
    expect(
      retryMessages.some(
        (message: any) =>
          message.role === "assistant" && message.content === "テストを実行します。",
      ),
    ).toBe(true);
    expect(
      retryMessages.some(
        (message: any) =>
          typeof message.content === "string" &&
          message.content.includes("no tool call was emitted"),
      ),
    ).toBe(true);
    expect(reportedToolCalls()).toHaveLength(1);
    // The buffered announcement is never shown to the user.
    expect(reportedText()).toBe("");
  });

  it("does not nudge when the model stopped for another reason", async () => {
    streamMock.mockImplementation(() => streamOf(textChunk("テストを実行します。", "length")));

    await run({ options: toolOptions(READ_FILE_TOOL) });

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(reportedText()).toBe("テストを実行します。");
  });
});

describe("processOpenAIStream — responses without visible output", () => {
  it("reports a notice when the model only produced reasoning", async () => {
    streamMock.mockImplementation(() => streamOf(reasoningChunk("weighing options")));

    await run();

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(reportedText()).toContain("internal reasoning but produced no visible response");
  });

  it("reports a notice when the stream yielded nothing at all", async () => {
    streamMock.mockImplementation(() => streamOf());

    await run();

    expect(reportedText()).toContain("internal reasoning but produced no visible response");
  });
});

describe("processOpenAIStream — transport failures", () => {
  it("retries the stream when it fails after producing output, then succeeds", async () => {
    streamMock
      .mockImplementationOnce(() => failingStream(new Error("connection reset"), textChunk("part")))
      .mockImplementationOnce(() => streamOf(textChunk("recovered")));

    await run();

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(reportedText()).toBe("recovered");
  });

  it("maps an AbortError raised mid-stream to a CancellationError", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    streamMock.mockImplementation(() => failingStream(abortError, textChunk("part")));

    await expect(run()).rejects.toBeInstanceOf(vscode.CancellationError);
  });

  it("throws the stream error unchanged when it happens before any output", async () => {
    streamMock.mockImplementation(() => failingStream(new Error("boom")));

    await expect(run()).rejects.toThrow("boom");
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it("throws the last attempt's error once every retry is exhausted", async () => {
    // Each attempt emits output first, so all three are retryable until the
    // final one has nowhere left to go.
    streamMock
      .mockImplementationOnce(() => failingStream(new Error("boom-1"), textChunk("part")))
      .mockImplementationOnce(() => failingStream(new Error("boom-2"), textChunk("part")))
      .mockImplementationOnce(() => failingStream(new Error("boom-3"), textChunk("part")));

    await expect(run()).rejects.toThrow("boom-3");
    expect(streamMock).toHaveBeenCalledTimes(3);
  });
});
