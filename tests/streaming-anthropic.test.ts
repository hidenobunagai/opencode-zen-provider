import * as vscode from "vscode";
import { fetchWithRetry, resolveApiEndpoint } from "../src/api";
import { handleAnthropicRequest, type AnthropicRequestParams } from "../src/streaming/anthropic";

jest.mock("../src/api", () => ({
  fetchWithRetry: jest.fn(),
  resolveApiEndpoint: jest.fn(() => "https://opencode.ai/zen/v1/messages"),
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

const fetchWithRetryMock = fetchWithRetry as unknown as jest.Mock;
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

const USER_MESSAGE = { role: 1, content: [{ value: "Hi" }] } as any;

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
}

function okResponse(lines: string[]) {
  return { ok: true, status: 200, statusText: "OK", body: sseStream(lines) };
}

/** A body whose reader always rejects, to exercise the stream error paths. */
function failingBody(error: Error): ReadableStream<Uint8Array> {
  return {
    getReader: () => ({
      read: jest.fn().mockRejectedValue(error),
      releaseLock: jest.fn(),
    }),
  } as unknown as ReadableStream<Uint8Array>;
}

function toolOptions(toolMode?: number) {
  return {
    tools: [READ_FILE_TOOL],
    ...(toolMode === undefined ? {} : { toolMode }),
  } as any;
}

function baseParams(
  progress: { report: jest.Mock },
  overrides: Partial<AnthropicRequestParams> = {},
): AnthropicRequestParams {
  return {
    modelId: "claude-opus-4-7",
    messages: [USER_MESSAGE],
    options: {} as any,
    requestOptions: {} as any,
    apiKey: "test-key",
    requestedMaxTokens: 4096,
    temperatureVal: 0,
    progress: progress as any,
    token: {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    } as any,
    abortController: { signal: undefined } as any,
    fallbackModels: [],
    userAgent: "test-ua",
    ...overrides,
  };
}

function reportedText(progress: { report: jest.Mock }): string {
  return progress.report.mock.calls
    .map((call) => call[0])
    .filter((part) => part instanceof vscode.LanguageModelTextPart)
    .map((part) => (part as vscode.LanguageModelTextPart).value)
    .join("");
}

function reportedToolCalls(progress: { report: jest.Mock }): vscode.LanguageModelToolCallPart[] {
  return progress.report.mock.calls
    .map((call) => call[0])
    .filter(
      (part): part is vscode.LanguageModelToolCallPart =>
        part instanceof vscode.LanguageModelToolCallPart,
    );
}

function requestBodyOf(callIndex = 0): any {
  return JSON.parse(fetchWithRetryMock.mock.calls[callIndex][1].body);
}

describe("handleAnthropicRequest — request construction", () => {
  let progress: { report: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    resolveApiEndpointMock.mockReturnValue("https://opencode.ai/zen/v1/messages");
    progress = { report: jest.fn() };
  });

  it("builds a thinking request with tools and an explicit tool_choice", async () => {
    const options = toolOptions(vscode.LanguageModelChatToolMode.Required);
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
        'data: {"type":"message_stop"}',
      ]),
    );

    await handleAnthropicRequest(
      baseParams(progress, {
        options,
        requestOptions: options,
        reasoningEffort: "high",
      }),
    );

    const body = requestBodyOf();
    // 4096 * 0.6 = 2457.6 -> 2458, clamped into [1024, maxTokens - 1024].
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2458 });
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBeUndefined();
    expect(body.tool_choice).toEqual({ type: "tool", name: "read_file" });
    expect(body.tools).toHaveLength(1);
    expect(body.system).toEqual(expect.any(String));
    expect(reportedText(progress)).toBe("ok");
  });

  it("falls back to temperature when no thinking budget applies", async () => {
    fetchWithRetryMock.mockResolvedValue(okResponse(['data: {"type":"message_stop"}']));

    await handleAnthropicRequest(baseParams(progress, { temperatureVal: 0.3 }));

    const body = requestBodyOf();
    expect(body.temperature).toBe(0.3);
    expect(body.thinking).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.max_tokens).toBe(4096);
  });

  it("clamps a low reasoning effort budget to the 1024-token floor", async () => {
    fetchWithRetryMock.mockResolvedValue(okResponse(['data: {"type":"message_stop"}']));

    await handleAnthropicRequest(
      baseParams(progress, { reasoningEffort: "low", requestedMaxTokens: 2048 }),
    );

    expect(requestBodyOf().thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  it("ignores an unknown reasoning effort", async () => {
    fetchWithRetryMock.mockResolvedValue(okResponse(['data: {"type":"message_stop"}']));

    await handleAnthropicRequest(baseParams(progress, { reasoningEffort: "banana" }));

    expect(requestBodyOf().thinking).toBeUndefined();
  });

  it("uses the OpenAI tool schema for DeepSeek models", async () => {
    const options = toolOptions(vscode.LanguageModelChatToolMode.Required);
    fetchWithRetryMock.mockResolvedValue(okResponse(['data: {"type":"message_stop"}']));

    await handleAnthropicRequest(
      baseParams(progress, {
        modelId: "deepseek-v4-pro",
        options,
        requestOptions: options,
      }),
    );

    const body = requestBodyOf();
    expect(body.tools[0]).toMatchObject({ type: "function", function: { name: "read_file" } });
    expect(body.tool_choice).toBe("required");
    // Reasoning models omit max_tokens so the whole budget is not spent on thinking.
    expect(body.max_tokens).toBeUndefined();
  });

  it("throws when there are no messages to send", async () => {
    await expect(handleAnthropicRequest(baseParams(progress, { messages: [] }))).rejects.toThrow(
      "No messages to send to Anthropic API",
    );
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });
});

describe("handleAnthropicRequest — transport failures", () => {
  let progress: { report: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    resolveApiEndpointMock.mockReturnValue("https://opencode.ai/zen/v1/messages");
    progress = { report: jest.fn() };
  });

  it("surfaces a non-OK response together with its body", async () => {
    fetchWithRetryMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: jest.fn().mockResolvedValue("upstream exploded"),
    });

    await expect(handleAnthropicRequest(baseParams(progress))).rejects.toThrow(
      "500 Internal Server Error\nupstream exploded",
    );
  });

  it("throws when the response carries no body", async () => {
    fetchWithRetryMock.mockResolvedValue({ ok: true, status: 200, statusText: "OK", body: null });

    await expect(handleAnthropicRequest(baseParams(progress))).rejects.toThrow(
      "No response body from Anthropic API",
    );
  });

  it("retries the request when the stream throws, then succeeds", async () => {
    // First body throws on read; second body streams normally.
    fetchWithRetryMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        body: failingBody(new Error("connection reset")),
      })
      .mockResolvedValueOnce(
        okResponse([
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"recovered"}}',
        ]),
      );

    await handleAnthropicRequest(baseParams(progress, { modelId: "claude-opus-4-7" }));

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
    expect(reportedText(progress)).toBe("recovered");
  });

  it("propagates an AbortError from fetch unchanged so the caller can map it", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    fetchWithRetryMock.mockRejectedValue(abortError);

    // The fetch call sits outside the stream try/catch, so the AbortError is
    // rethrown as-is; provider.ts maps it to CancellationError.
    await expect(handleAnthropicRequest(baseParams(progress))).rejects.toThrow("aborted");
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
  });

  it("maps an AbortError raised while acquiring the body reader to a CancellationError", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    fetchWithRetryMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: {
        getReader: () => {
          throw abortError;
        },
      },
    });

    await expect(handleAnthropicRequest(baseParams(progress))).rejects.toBeInstanceOf(
      vscode.CancellationError,
    );
  });

  it("maps an AbortError raised mid-stream to a CancellationError", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    fetchWithRetryMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: failingBody(abortError),
    });

    await expect(
      handleAnthropicRequest(baseParams(progress, { modelId: "deepseek-v4-pro" })),
    ).rejects.toBeInstanceOf(vscode.CancellationError);
  });

  it("throws a CancellationError before fetching when the token is cancelled", async () => {
    const params = baseParams(progress);
    (params.token as any).isCancellationRequested = true;

    await expect(handleAnthropicRequest(params)).rejects.toBeInstanceOf(vscode.CancellationError);
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });

  it("throws the last attempt's error once every retry is exhausted", async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        body: failingBody(new Error("boom-1")),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        body: failingBody(new Error("boom-2")),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        body: failingBody(new Error("boom-3")),
      });

    await expect(handleAnthropicRequest(baseParams(progress))).rejects.toThrow("boom-3");
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(3);
  });
});

describe("handleAnthropicRequest — Anthropic tool_use blocks", () => {
  let progress: { report: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    resolveApiEndpointMock.mockReturnValue("https://opencode.ai/zen/v1/messages");
    progress = { report: jest.fn() };
  });

  function toolParams(overrides: Partial<AnthropicRequestParams> = {}) {
    const options = toolOptions();
    return baseParams(progress, { options, requestOptions: options, ...overrides });
  }

  it("emits a native tool_use block as a tool call part", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        'data: {"type":"message_start","message":{"id":"msg_01"}}',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"read_file"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"filePath\\":"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"src/app.ts\\"}"}}',
        'data: {"type":"content_block_stop","index":0}',
        'data: {"type":"message_stop"}',
      ]),
    );

    await handleAnthropicRequest(toolParams());

    const calls = reportedToolCalls(progress);
    expect(calls).toHaveLength(1);
    expect(calls[0].callId).toBe("toolu_01");
    expect(calls[0].name).toBe("read_file");
    expect(calls[0].input).toEqual({ filePath: "src/app.ts" });
  });

  it("falls back to a generated id and name for a sparse tool_use block", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use"}}',
        'data: {"type":"content_block_stop","index":0}',
      ]),
    );

    await handleAnthropicRequest(toolParams());

    const calls = reportedToolCalls(progress);
    expect(calls).toHaveLength(1);
    expect(calls[0].callId).toMatch(/^tu_/);
    expect(calls[0].name).toBe("unknown_tool");
  });

  it("skips a tool_use block with missing required arguments and reports the fallback", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_02","name":"read_file"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"unrelated\\":true}"}}',
        'data: {"type":"content_block_stop","index":0}',
      ]),
    );

    await handleAnthropicRequest(toolParams());

    expect(reportedToolCalls(progress)).toHaveLength(0);
    expect(reportedText(progress)).toContain("filePath");
  });

  it("survives a tool_use block whose accumulated JSON is invalid", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_03","name":"read_file"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{not json"}}',
        'data: {"type":"content_block_stop","index":0}',
      ]),
    );

    await handleAnthropicRequest(toolParams());

    expect(reportedToolCalls(progress)).toHaveLength(0);
    expect(reportedText(progress)).toContain("filePath");
  });

  it("retries when the stream ends with an unfinished tool_use block", async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce(
        okResponse([
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_04","name":"read_file"}}',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"filePath\\":\\"a.ts\\"}"}}',
        ]),
      )
      .mockResolvedValueOnce(
        okResponse([
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"second pass"}}',
        ]),
      );

    await handleAnthropicRequest(toolParams());

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
    expect(reportedText(progress)).toBe("second pass");
  });

  it("does not retry a reasoning model that stops mid tool_use", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_05","name":"read_file"}}',
      ]),
    );

    await handleAnthropicRequest(toolParams({ modelId: "deepseek-v4-pro" }));

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
  });
});

describe("handleAnthropicRequest — text deltas and embedded tool calls", () => {
  let progress: { report: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    resolveApiEndpointMock.mockReturnValue("https://opencode.ai/zen/v1/messages");
    progress = { report: jest.fn() };
  });

  function toolParams(overrides: Partial<AnthropicRequestParams> = {}) {
    const options = toolOptions();
    return baseParams(progress, { options, requestOptions: options, ...overrides });
  }

  it("collects thinking deltas without emitting them", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"weighing options"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}',
      ]),
    );

    await handleAnthropicRequest(baseParams(progress));

    expect(reportedText(progress)).toBe("answer");
  });

  it("turns a text-embedded tool call into a tool call part", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        `data: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "text_delta",
            text: 'Sure.\n<tool_call>read_file filePath="src/app.ts"</tool_call>',
          },
        })}`,
      ]),
    );

    await handleAnthropicRequest(toolParams());

    const calls = reportedToolCalls(progress);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("read_file");
    expect(calls[0].input).toEqual({ filePath: "src/app.ts" });
    expect(reportedText(progress)).toContain("Sure.");
  });

  it("flushes an incomplete embedded tool call marker as plain text", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        `data: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: 'Working <tool_call>read_file filePath="/src' },
        })}`,
      ]),
    );

    await handleAnthropicRequest(toolParams());

    expect(reportedToolCalls(progress)).toHaveLength(0);
    expect(reportedText(progress)).toBe('Working <tool_call>read_file filePath="/src');
  });

  it("ignores blank lines, event-only lines, [DONE] and malformed JSON", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        "",
        "event: content_block_delta",
        "{}",
        "data: [DONE]",
        "data: {not valid json",
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"survived"}}',
      ]),
    );

    await handleAnthropicRequest(baseParams(progress));

    expect(reportedText(progress)).toBe("survived");
  });

  it("parses a bare JSON line without the data: prefix", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"raw"}}',
      ]),
    );

    await handleAnthropicRequest(baseParams(progress));

    expect(reportedText(progress)).toBe("raw");
  });
});

describe("handleAnthropicRequest — OpenAI-style chunks on the messages endpoint", () => {
  let progress: { report: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    resolveApiEndpointMock.mockReturnValue("https://opencode.ai/zen/v1/messages");
    progress = { report: jest.fn() };
  });

  function toolParams(overrides: Partial<AnthropicRequestParams> = {}) {
    const options = toolOptions();
    return baseParams(progress, { options, requestOptions: options, ...overrides });
  }

  function chunk(choices: unknown[]): string {
    return `data: ${JSON.stringify({ object: "chat.completion.chunk", choices })}`;
  }

  it("emits text and tool calls from chat.completion.chunk events", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        chunk([{ index: 0, delta: { role: "assistant", content: "Let me read that. " } }]),
        chunk([
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  function: { name: "read_file", arguments: "" },
                },
              ],
            },
          },
        ]),
        chunk([
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"filePath":' } }] },
          },
        ]),
        chunk([
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] },
          },
        ]),
        chunk([{ index: 0, delta: {}, finish_reason: "tool_calls" }]),
        "data: [DONE]",
      ]),
    );

    await handleAnthropicRequest(toolParams());

    const calls = reportedToolCalls(progress);
    expect(calls).toHaveLength(1);
    expect(calls[0].callId).toBe("call_abc");
    expect(calls[0].input).toEqual({ filePath: "a.ts" });
    expect(reportedText(progress)).toBe("Let me read that. ");
  });

  it("skips an OpenAI-style tool call with unparseable arguments", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        chunk([
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_bad", function: { name: "read_file", arguments: "{oops" } },
              ],
            },
          },
        ]),
        chunk([{ index: 0, delta: {}, finish_reason: "tool_calls" }]),
      ]),
    );

    await handleAnthropicRequest(toolParams());

    expect(reportedToolCalls(progress)).toHaveLength(0);
    expect(reportedText(progress)).toContain("filePath");
  });

  it("ignores chunk events that are not chat.completion.chunk", async () => {
    fetchWithRetryMock.mockResolvedValue(
      okResponse([
        'data: {"object":"unknown.event","choices":[{"index":0,"delta":{"content":"nope"}}]}',
      ]),
    );

    await handleAnthropicRequest(baseParams(progress));

    expect(progress.report).not.toHaveBeenCalled();
  });
});
