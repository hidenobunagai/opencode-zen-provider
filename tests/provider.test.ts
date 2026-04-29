import * as vscode from "vscode";
import { streamChatCompletion } from "../src/api";
import { ZenChatModelProvider } from "../src/provider";

jest.mock("../src/api", () => ({
  streamChatCompletion: jest.fn(),
  fetchWithRetry: jest.fn(),
  resolveApiEndpoint: jest.fn(() => "https://opencode.ai/zen/v1/chat/completions"),
}));

jest.mock("vscode", () => ({
  SecretStorage: class {},
  LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 0 },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  LanguageModelToolCallPart: class {
    constructor(
      public callId: string,
      public name: string,
      public input: Record<string, unknown>,
    ) {}
  },
  LanguageModelToolResultPart: class {
    constructor(
      public callId: string,
      public content: unknown[],
    ) {}
  },
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    showInputBox: jest.fn(),
  },
  workspace: {
    workspaceFolders: undefined,
  },
  LanguageModelError: {
    NoPermissions: (msg: string) => new Error(msg),
    NotFound: (msg: string) => new Error(msg),
    Blocked: (msg: string) => new Error(msg),
  },
  CancellationError: class extends Error {},
  EventEmitter: class {
    event = jest.fn();
    fire = jest.fn();
  },
  Memento: class {},
}));

describe("ZenChatModelProvider", () => {
  let secrets: vscode.SecretStorage;
  let provider: ZenChatModelProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    secrets = {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(),
    } as unknown as vscode.SecretStorage;
    provider = new ZenChatModelProvider(secrets, "test-ua");
    ((vscode as any).window.showInputBox as jest.Mock).mockResolvedValue(undefined);
  });

  it("provideLanguageModelChatInformation returns bundled fallback models", async () => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true } as any,
      token as any,
    );
    expect(infos.length).toBeGreaterThan(0);
    expect(infos[0].name).toBeDefined();
  });

  it("syncs a configured API key from provider configuration", async () => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: { apiKey: " configured-api-key " } } as any,
      token as any,
    );

    expect(secrets.store).toHaveBeenCalledWith("opencode-zen.apiKey", "configured-api-key");
  });

  it("clears the compatibility secret when configured API key is removed", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("stale-api-key");

    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: { apiKey: "   " } } as any,
      token as any,
    );

    expect(secrets.delete).toHaveBeenCalledWith("opencode-zen.apiKey");
  });

  it("preserves the compatibility secret when configuration omits apiKey", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("stored-api-key");

    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatInformation(
      { silent: true, configuration: {} } as any,
      token as any,
    );

    expect(secrets.delete).not.toHaveBeenCalled();
    expect(secrets.store).not.toHaveBeenCalled();
  });

  it("provideLanguageModelChatInformation returns empty array on cancellation", async () => {
    const token = {
      isCancellationRequested: true,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const infos = await provider.provideLanguageModelChatInformation(
      { silent: true } as any,
      token as any,
    );
    expect(infos).toEqual([]);
  });

  it("provideLanguageModelChatResponse streams text parts", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Hello" } }] };
      yield { choices: [{ delta: { content: " world" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    expect(streamChatCompletion).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({ model: "kimi-k2.6", stream: true }),
      expect.any(String),
      expect.any(AbortSignal),
      "test-ua",
    );
    expect(progress.report).toHaveBeenCalledTimes(1);
    expect(progress.report).toHaveBeenCalledWith(expect.objectContaining({ value: "Hello world" }));
  });

  it("throws when message exceeds token limit", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await expect(
      provider.provideLanguageModelChatResponse(
        { id: "kimi-k2.6", maxInputTokens: 1, maxOutputTokens: 65536 } as any,
        [
          {
            role: 1,
            content: [{ value: "This is a very long message that exceeds the token limit" }],
          },
        ] as any,
        { modelOptions: {} } as any,
        progress,
        token as any,
      ),
    ).rejects.toThrow("Message exceeds token limit");
  });

  it("prompts for an API key during chat and continues the request when one is provided", async () => {
    (secrets.get as jest.Mock).mockResolvedValue(undefined);
    ((vscode as any).window.showInputBox as jest.Mock).mockResolvedValue("new-api-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Hello from OpenCode Zen" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    expect((vscode as any).window.showInputBox).toHaveBeenCalled();
    expect(secrets.store).toHaveBeenCalledWith("opencode-zen.apiKey", "new-api-key");
    expect(streamChatCompletion).toHaveBeenCalledWith(
      "new-api-key",
      expect.objectContaining({ model: "kimi-k2.6", stream: true }),
      expect.any(String),
      expect.any(AbortSignal),
      "test-ua",
    );
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({ value: "Hello from OpenCode Zen" }),
    );
  });

  it("uses a configured API key from model configuration without prompting", async () => {
    (secrets.get as jest.Mock).mockResolvedValue(undefined);

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Hello from configuration" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      { modelOptions: {}, modelConfiguration: { apiKey: "configured-api-key" } } as any,
      progress,
      token as any,
    );

    expect((vscode as any).window.showInputBox).not.toHaveBeenCalled();
    expect(secrets.store).toHaveBeenCalledWith("opencode-zen.apiKey", "configured-api-key");
    expect(streamChatCompletion).toHaveBeenCalledWith(
      "configured-api-key",
      expect.objectContaining({ model: "kimi-k2.6", stream: true }),
      expect.any(String),
      expect.any(AbortSignal),
      "test-ua",
    );
  });

  it("falls back to provider configuration when model configuration has no API key", async () => {
    (secrets.get as jest.Mock).mockResolvedValue(undefined);

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Hello from provider configuration" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        configuration: { apiKey: "provider-api-key" },
        modelConfiguration: {},
      } as any,
      progress,
      token as any,
    );

    expect((vscode as any).window.showInputBox).not.toHaveBeenCalled();
    expect(streamChatCompletion).toHaveBeenCalledWith(
      "provider-api-key",
      expect.objectContaining({ model: "kimi-k2.6", stream: true }),
      expect.any(String),
      expect.any(AbortSignal),
      "test-ua",
    );
  });

  it("returns setup guidance in chat when no API key is available", async () => {
    (secrets.get as jest.Mock).mockResolvedValue(undefined);
    ((vscode as any).window.showInputBox as jest.Mock).mockResolvedValue(undefined);

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.stringContaining("OpenCode Zen API key") }),
    );
  });

  it("streams tool call parts", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city": "Tokyo"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports.length).toBe(1);
    expect(toolCallReports[0][0].callId).toBe("call_1");
    expect(toolCallReports[0][0].name).toBe("get_weather");
    expect(toolCallReports[0][0].input).toEqual({ city: "Tokyo" });
  });

  it("streams Anthropic text deltas from raw JSON lines", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("{}\n"));
        controller.enqueue(
          encoder.encode(
            '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            '{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":1,"output_tokens":2}}\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n"));
        controller.close();
      },
    });

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/event-stream; charset=utf-8" }),
      body: stream,
    };

    (require("../src/api").fetchWithRetry as jest.Mock).mockResolvedValue(mockResponse);

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "claude-sonnet-4-6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    const emittedText = progress.report.mock.calls
      .map((call: any[]) => call[0]?.value)
      .filter((value: unknown): value is string => typeof value === "string")
      .join("");

    expect(emittedText).toBe("Hello world");
  });

  it("adds tool grounding guidance for non-DeepSeek models too", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "done" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [
            new vscode.LanguageModelTextPart(
              "まずワークスペース一覧を見てから最新ファイルを読んで要約して",
            ),
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "list_dir",
            description: "List a directory",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
          {
            name: "read_file",
            description: "Read a file",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)?.[1];
    const systemMessages = requestBody.messages.filter((message: any) => message.role === "system");

    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toContain(
      "For read_file, always provide filePath and the required line range fields from the available editor context before calling the tool.",
    );
    expect(systemMessages[0].content).toContain(
      "If you do not know the file path or line range, ask for clarification instead of emitting an empty read_file call.",
    );
  });

  it("emits text that appears before a tool call in the same response", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "Let me check " } }] };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    expect(progress.report.mock.calls).toHaveLength(2);
    expect(progress.report.mock.calls[0][0]).toEqual(
      expect.objectContaining({ value: "Let me check " }),
    );
    expect(progress.report.mock.calls[1][0]).toEqual(
      expect.objectContaining({ callId: "call_1", name: "get_weather" }),
    );
  });

  it("emits text that appears after a tool call in the same response", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
                },
              ],
            },
          },
        ],
      };
      yield { choices: [{ delta: { content: "Now I have the weather." } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    expect(progress.report.mock.calls).toHaveLength(2);
    expect(progress.report.mock.calls[0][0]).toEqual(
      expect.objectContaining({ callId: "call_1", name: "get_weather" }),
    );
    expect(progress.report.mock.calls[1][0]).toEqual(
      expect.objectContaining({ value: "Now I have the weather." }),
    );
  });

  it("sends required tool choice when tool mode requires a tool", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "done" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
        toolMode: 2,
      } as any,
      progress,
      token as any,
    );

    const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)?.[1];
    expect(requestBody.tool_choice).toBe("required");
  });

  it("assembles tool call arguments split across chunks", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city": ' },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '"Tokyo"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Hi" }] }] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports.length).toBe(1);
    expect(toolCallReports[0][0].input).toEqual({ city: "Tokyo" });
  });

  it("does not emit tool calls with empty arguments when schema requires fields", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(0);
  });

  it("returns a text fallback when all tool calls are skipped as invalid", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("filePath");
    expect(textReports[0][0].value).toContain("read_file");
  });

  it("returns a text fallback when invalid tool calls are preceded by whitespace content", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: " " } }] };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("filePath");
    expect(textReports[0][0].value).toContain("read_file");
  });

  it("emits a tool call parsed from text-embedded control tokens", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                '<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"/tmp/example.md"}<|tool_call_end|>',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({ filePath: "/tmp/example.md" });
  });

  it("emits a tool call parsed from a fenced JSON tool block for no-tool models", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                'まずは関連するスキルを読み込み、対象ファイルの全体を確認します。\n\n```json\n[\n  {\n    "tool": "read_file",\n    "parameters": {\n      "filePath": "/tmp/example.md",\n      "startLine": 1,\n      "endLine": 31\n    }\n  }\n]\n```',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "hy3-preview-free", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "このこの文章の校正をお願いします" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 1,
      endLine: 31,
    });
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("まずは関連するスキル");
    expect(textReports[0][0].value).not.toContain("```json");
    expect(textReports[0][0].value).not.toContain('"tool": "read_file"');
  });

  it("emits a runSubagent call parsed from a fenced legacy JSON tool block for no-tool models", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const prompt =
      "Summarize the entire workspace directory at /Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes. List all files and folders, their purposes, key topics covered (e.g., PTA activities, job interview preparation, work tasks, personal moments, archived notes). Note any patterns in dating, file naming conventions, and content themes. Thoroughness: quick";

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content: `ワークスペース全体のサマリーを取得するため、Explore サブエージェントを使用してフォルダの構造と内容を調査します。\n\n\`\`\`json\n{\n  "tool": "runSubagent",\n  "agentName": "Explore",\n  "argument": ${JSON.stringify(prompt)}\n}\n\`\`\``,
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "hy3-preview-free", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "フォルダ全体を見てサマリーをください。" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "runSubagent",
            description: "Launch a subagent",
            inputSchema: {
              type: "object",
              properties: {
                prompt: { type: "string" },
                description: { type: "string" },
                agentName: { type: "string" },
              },
              required: ["prompt", "description"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("runSubagent");
    expect(toolCallReports[0][0].input).toEqual({
      agentName: "Explore",
      prompt,
      description: "Run Explore subagent",
    });
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("Explore サブエージェント");
    expect(textReports[0][0].value).not.toContain("```json");
    expect(textReports[0][0].value).not.toContain('"tool": "runSubagent"');
  });

  it("repairs a missing runSubagent prompt from the latest user request", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const userRequest = "フォルダ全体を見てサマリーをください。";
    const wrappedUserRequest = `<attachments>\n<attachment id="file:example.md">\nExcerpt\n</attachment>\n</attachments>\n<context>\nThe current date is 2026年4月28日.\n</context>\n<userRequest>\n${userRequest}\n</userRequest>`;

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                'フォルダ全体のサマリーを作成するために、まずはファイル構造を詳しく調べます。Explore サブエージェントを使って効率的に情報を収集します。\n\n```json\n{\n  "tool": "runSubagent",\n  "agentName": "Explore"\n}\n```',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "hy3-preview-free", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: wrappedUserRequest }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "runSubagent",
            description: "Launch a subagent",
            inputSchema: {
              type: "object",
              properties: {
                prompt: { type: "string" },
                description: { type: "string" },
                agentName: { type: "string" },
              },
              required: ["prompt", "description"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("runSubagent");
    expect(toolCallReports[0][0].input).toEqual({
      agentName: "Explore",
      prompt: userRequest,
      description: "Run Explore subagent",
    });
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("Explore サブエージェント");
    expect(textReports[0][0].value).not.toContain("required argument(s) `prompt`");
  });

  it("repairs a missing runSubagent agentName from surrounding assistant text", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const userRequest = "フォルダ全体を見てサマリーをください。";
    const wrappedUserRequest = `<attachments>\n<attachment id="file:example.md">\nExcerpt\n</attachment>\n</attachments>\n<context>\nThe current date is 2026年4月28日.\n</context>\n<userRequest>\n${userRequest}\n</userRequest>`;

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                'まず、スーパーパワースキルを確認し、その後でワークスペース全体を探索してサマリーを提供します。\n\n`using-superpowers` スキルは既にコンテキストに読み込まれています。次に、`Explore` エージェントを使用してワークスペース全体を探索します。\n\n```json\n{\n  "tool": "runSubagent",\n  "argument": ' +
                JSON.stringify(userRequest) +
                "\n}\n```",
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "hy3-preview-free", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: wrappedUserRequest }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "runSubagent",
            description: "Launch a subagent",
            inputSchema: {
              type: "object",
              properties: {
                prompt: { type: "string" },
                description: { type: "string" },
                agentName: { type: "string" },
              },
              required: ["prompt", "description"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("runSubagent");
    expect(toolCallReports[0][0].input).toEqual({
      agentName: "Explore",
      prompt: userRequest,
      description: "Run Explore subagent",
    });
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("Explore");
    expect(textReports[0][0].value).not.toContain('"tool": "runSubagent"');
  });

  it("flushes an incomplete fenced JSON block as text at stream end", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                '```json\n[\n  {\n    "tool": "read_file",\n    "parameters": {\n      "filePath": "/tmp/example.md"\n    }\n  }\n]',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "hy3-preview-free", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "このこの文章の校正をお願いします" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(0);
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain('"tool": "read_file"');
    expect(textReports[0][0].value).toContain("```json");
  });

  it("emits a tool call parsed from a compact xml tool block for no-tool models", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                'まず、core-principles スキルを読み込みます。これはセッション開始時に必須です。\n<tool_calls>\n<tool_call>read_file path="/Users/hidenobunagai/.agents/skills/core-principles/SKILL.md"</tool_call>\n</tool_calls>',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "hy3-preview-free", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<editorContext>\nThe user's current file is /tmp/current.md. The current selection is from line 10 to line 12.\n</editorContext>\n<userRequest>このメモのサマリーをください。</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/Users/hidenobunagai/.agents/skills/core-principles/SKILL.md",
      startLine: 1,
      endLine: 200,
    });
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("core-principles スキル");
    expect(textReports[0][0].value).not.toContain("<tool_calls>");
  });

  it("emits read_file calls parsed from tool_sep arg_key arg_value tool blocks for no-tool models", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                "サブエージェントの結果を読み取るために、まずファイルの内容を確認します。サブエージェントの結果ファイルを読み取ります。まず、そのファイルの内容を確認します。サブエージェントの結果ファイルを正しく読み取ります。サブエージェントの結果を読み取るために、まずファイルを直接読み取ります。ワークスペースのファイルを直接探索してサマリーを作成します。まず、主要なファイルを読み取って内容を確認します。<tool_calls>\n<tool_call>read_file<tool_sep>\n<arg_key>filePath</arg_key>\n<arg_value>/Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes/2026_02_11_データ分析の力.md</arg_value>\n<arg_key>startLine</arg_key>\n<arg_value>1</arg_value>\n<arg_key>endLine</arg_key>\n<arg_value>50</arg_value>\n</tool_call>\n<tool_call>read_file<tool_sep>\n<arg_key>filePath</arg_key>\n<arg_value>/Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes/2026-03-07_07-02_カード一覧.md</arg_value>\n<arg_key>startLine</arg_key>\n<arg_value>1</arg_value>\n<arg_key>endLine</arg_key>\n<arg_key>50</arg_value>\n</tool_call>\n<tool_call>read_file<tool_sep>\n<arg_key>filePath</arg_key>\n<arg_value>/Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes/2026-04-17_21-14-52_カタリナ_タレント名鑑.md</arg_value>\n<arg_key>startLine</arg_key>\n<arg_key>1</arg_value>\n<arg_key>endLine</arg_key>\n<arg_value>50</arg_value>\n</tool_call>\n<tool_call>read_file<tool_sep>\n<arg_key>filePath</arg_key>\n<arg_value>/Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes/thino_archive.md</arg_value>\n<arg_key>startLine</arg_key>\n<arg_value>1</arg_value>\n<arg_key>endLine</arg_key>\n<arg_value>50</arg_value>\n</tool_call>\n</tool_calls>",
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "hy3-preview-free", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "フォルダ全体を見てサマリーをください。" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(4);
    expect(toolCallReports.map((c: any) => c[0].name)).toEqual([
      "read_file",
      "read_file",
      "read_file",
      "read_file",
    ]);
    expect(toolCallReports.map((c: any) => c[0].input)).toEqual([
      {
        filePath:
          "/Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes/2026_02_11_データ分析の力.md",
        startLine: 1,
        endLine: 50,
      },
      {
        filePath:
          "/Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes/2026-03-07_07-02_カード一覧.md",
        startLine: 1,
        endLine: 50,
      },
      {
        filePath:
          "/Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes/2026-04-17_21-14-52_カタリナ_タレント名鑑.md",
        startLine: 1,
        endLine: 50,
      },
      {
        filePath:
          "/Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes/thino_archive.md",
        startLine: 1,
        endLine: 50,
      },
    ]);
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("サブエージェントの結果を読み取るために");
    expect(textReports[0][0].value).not.toContain("<tool_calls>");
    expect(textReports[0][0].value).not.toContain("<arg_key>");
  });

  it("emits a runSubagent call parsed from a malformed xml tool block for no-tool models", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const prompt =
      "Describe the overall content and themes of this Notes workspace. I need a summary of: 1) Main folder markdown files and their topics, 2) archive/ folder contents, 3) moments/ folder pattern, 4) tasks/ folder structure. Keep it quick - just identify themes and date ranges.";

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content: `I'll use the Explore agent to quickly scan the workspace contents and provide you with a summary.<tool_calls>\n<tool_call>runSubagent<tool_call>name">Explore</name>\n<argument>${prompt}</argument>\n<argumentHint>quick</argumentHint>\n</runSubagent>`,
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "hy3-preview-free", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "フォルダ全体を見てサマリーをください。" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "runSubagent",
            description: "Launch a subagent",
            inputSchema: {
              type: "object",
              properties: {
                prompt: { type: "string" },
                description: { type: "string" },
                agentName: { type: "string" },
              },
              required: ["prompt", "description"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("runSubagent");
    expect(toolCallReports[0][0].input).toEqual({
      agentName: "Explore",
      prompt,
      description: "quick",
    });
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("Explore agent");
    expect(textReports[0][0].value).not.toContain("<tool_calls>");
  });

  it("emits a runSubagent call parsed from nested tool_call markers for no-tool models", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const prompt =
      "Summarize the entire workspace folder at /Users/hidenobunagai/Library/CloudStorage/GoogleDrive-hidenobu.nagai.jp@gmail.com/マイドライブ/Documents/Notes. The workspace contains markdown files including notes, PTA meeting records, interview preparation documents, task lists, and daily moments. Provide a high-level summary of topics covered, key themes, organizational patterns, and any notable observations. Be thorough and include:\n1. Main categories of documents (e.g., PTA, interviews, personal notes)\n2. Time range of documents\n3. Recurring themes or topics\n4. Structure of subdirectories (archive, moments, tasks)\n5. Any unique or interesting findings";

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content: `フォルダ全体の要約を取得するために、\`Explore\` エージェントを使用します。これはコードベースやドキュメントの探索に特化したサブエージェントです。<tool_calls>\n<tool_call>runSubagent <tool_call>name <tool_call>Explore </tool_call> <tool_call>input <tool_call>${prompt} </tool_call> </tool_call> </tool_call>`,
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "hy3-preview-free", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "フォルダ全体を見てサマリーをください。" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "runSubagent",
            description: "Launch a subagent",
            inputSchema: {
              type: "object",
              properties: {
                prompt: { type: "string" },
                description: { type: "string" },
                agentName: { type: "string" },
              },
              required: ["prompt", "description"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("runSubagent");
    expect(toolCallReports[0][0].input).toEqual({
      agentName: "Explore",
      prompt,
      description: "Run Explore subagent",
    });
    expect(textReports).toHaveLength(1);
    expect(textReports[0][0].value).toContain("Explore");
    expect(textReports[0][0].value).not.toContain("<tool_calls>");
  });

  it("preserves text order around a text-embedded tool call", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                'Before <|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"/tmp/example.md"}<|tool_call_end|> after',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    expect(progress.report.mock.calls).toHaveLength(3);
    expect(progress.report.mock.calls[0][0]).toEqual(expect.objectContaining({ value: "Before " }));
    expect(progress.report.mock.calls[1][0]).toEqual(
      expect.objectContaining({ name: "read_file" }),
    );
    expect(progress.report.mock.calls[2][0]).toEqual(expect.objectContaining({ value: " after" }));
  });

  it("emits a tool call when text-embedded control tokens are split across chunks", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                '<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"/tmp/exa',
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              content: 'mple.md"}<|tool_call_end|>',
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Read the file" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: { filePath: { type: "string" } },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    const textReports = progress.report.mock.calls.filter((c: any) => c[0]?.value);

    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({ filePath: "/tmp/example.md" });
    expect(textReports).toHaveLength(0);
  });

  it("repairs empty read_file arguments from editor context", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<editorContext>\nThe user's current file is /tmp/example.md. The current selection is from line 158 to line 158.\n</editorContext>\n<userRequest>ツールを使ってファイルを読み込んでみてください</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 158,
      endLine: 158,
    });
  });

  it("repairs missing read_file line arguments from editor context", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: '{"filePath":"/tmp/example.md"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<editorContext>\nThe user's current file is /tmp/example.md. The current selection is from line 42 to line 45.\n</editorContext>\n<userRequest>Read the current selection</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 42,
      endLine: 45,
    });
  });

  it("does not inject selection lines when read_file line arguments are optional", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: '{"filePath":"/tmp/example.md"}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<editorContext>\nThe user's current file is /tmp/example.md. The current selection is from line 42 to line 45.\n</editorContext>\n<userRequest>Read the whole file</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].input).toEqual({ filePath: "/tmp/example.md" });
  });

  it("repairs read_file with the current file path even when no selection lines are provided", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<context>\nCwd: /tmp/workspace\n</context>\n<editorContext>\nThe user's current file is /tmp/example.md. \n</editorContext>\n<userRequest>Read the open file</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
              },
              required: ["filePath"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].input).toEqual({ filePath: "/tmp/example.md" });
  });

  it("defaults read_file line arguments when the schema requires a range but chat only provides the current file", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:0",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<context>\nCwd: /tmp/workspace\n</context>\n<editorContext>\nThe user's current file is /tmp/example.md. \n</editorContext>\n<userRequest>Check the current file</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 1,
      endLine: 200,
    });
  });

  it("repairs list_dir with the current working directory from chat context", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "list_dir:0",
                  type: "function",
                  function: { name: "list_dir", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<context>\nCwd: /tmp/workspace\n</context>\n<userRequest>List files in the current directory</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "list_dir",
            description: "List files in a directory",
            inputSchema: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
              required: ["path"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("list_dir");
    expect(toolCallReports[0][0].input).toEqual({ path: "/tmp/workspace" });
  });

  it("waits for later streamed arguments before validating a tool call", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "grep_search:0",
                  type: "function",
                  function: { name: "grep_search" },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"query":"causal","isRegexp":false}' },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [{ role: 1, content: [{ value: "Test the memory tool" }] }] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "grep_search",
            description: "Search notes by text",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query",
                },
                isRegexp: {
                  type: "boolean",
                  description: "Whether query is a regular expression",
                },
              },
              required: ["query", "isRegexp"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("grep_search");
    expect(toolCallReports[0][0].input).toEqual({ query: "causal", isRegexp: false });
  });

  it("repairs text-embedded read_file arguments from editor context", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              content:
                "<|tool_call_begin|>read_file<|tool_call_argument_begin|>{}<|tool_call_end|>",
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            {
              value:
                "<editorContext>\nThe user's current file is /tmp/example.md. The current selection is from line 10 to line 12.\n</editorContext>\n<userRequest>Read the selected lines</userRequest>",
            },
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0].name).toBe("read_file");
    expect(toolCallReports[0][0].input).toEqual({
      filePath: "/tmp/example.md",
      startLine: 10,
      endLine: 12,
    });
  });

  it("suppresses an immediate duplicate of the just-completed tool call", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"filePath":"/tmp/example.md","startLine":158,"endLine":158}',
                  },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 2,
          content: [
            new (vscode as any).LanguageModelToolCallPart("read_file:0", "read_file", {
              filePath: "/tmp/example.md",
              startLine: 158,
              endLine: 158,
            }),
          ],
        },
        {
          role: 1,
          content: [
            new (vscode as any).LanguageModelToolResultPart("read_file:0", [
              new (vscode as any).LanguageModelTextPart("**③ パネル・データ分析（差分の差分法）**"),
            ]),
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(0);
  });

  it("allows the same tool call again after an intervening user message", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "read_file:1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"filePath":"/tmp/example.md","startLine":158,"endLine":158}',
                  },
                },
              ],
            },
          },
        ],
      };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 2,
          content: [
            new (vscode as any).LanguageModelToolCallPart("read_file:0", "read_file", {
              filePath: "/tmp/example.md",
              startLine: 158,
              endLine: 158,
            }),
          ],
        },
        {
          role: 1,
          content: [
            new (vscode as any).LanguageModelToolResultPart("read_file:0", [
              new (vscode as any).LanguageModelTextPart("**③ パネル・データ分析（差分の差分法）**"),
            ]),
          ],
        },
        {
          role: 1,
          content: [new (vscode as any).LanguageModelTextPart("Read that same line again.")],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [
          {
            name: "read_file",
            description: "Read a file from disk",
            inputSchema: {
              type: "object",
              properties: {
                filePath: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["filePath", "startLine", "endLine"],
            },
          },
        ],
      } as any,
      progress,
      token as any,
    );

    const toolCallReports = progress.report.mock.calls.filter((c: any) => c[0]?.callId);
    expect(toolCallReports).toHaveLength(1);
    expect(toolCallReports[0][0]).toEqual(
      expect.objectContaining({ callId: "read_file:1", name: "read_file" }),
    );
  });

  it("sends non-empty reasoning_content for assistant tool call history", async () => {
    (secrets.get as jest.Mock).mockResolvedValue("test-key");

    const mockStream = async function* () {
      yield { choices: [{ delta: { content: "done" } }] };
    };
    (streamChatCompletion as jest.Mock).mockReturnValue(mockStream());

    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "kimi-k2.6", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 2,
          content: [
            new (vscode as any).LanguageModelTextPart("Let me check"),
            new (vscode as any).LanguageModelToolCallPart("call_1", "get_weather", {
              city: "Tokyo",
            }),
          ],
        },
        {
          role: 1,
          content: [
            new (vscode as any).LanguageModelToolResultPart("call_1", [
              new (vscode as any).LanguageModelTextPart("Sunny, 25C"),
            ]),
          ],
        },
      ] as any,
      {
        modelOptions: {},
        tools: [{ name: "get_weather", description: "Get weather", inputSchema: {} }],
      } as any,
      progress,
      token as any,
    );

    const requestBody = (streamChatCompletion as jest.Mock).mock.calls.at(-1)?.[1];
    expect(requestBody).toBeDefined();
    expect(requestBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: " ",
          tool_calls: expect.any(Array),
        }),
      ]),
    );
  });
});
