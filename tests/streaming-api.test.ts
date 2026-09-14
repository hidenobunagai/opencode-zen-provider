import { streamChatCompletion } from "../src/api";
import { BASE_URL } from "../src/constants";
import { parseTextEmbeddedToolCalls } from "../src/tool-parser";

function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
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

describe("VCR: streamChatCompletion with Anthropic SSE", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("yields parsed content_block_delta chunks", async () => {
    const events = [
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-opus-4-7"}}',
      "",
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      "",
      "event: content_block_stop",
      'data: {"type":"content_block_stop","index":0}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(events),
    } as any);

    const endpoint = `${BASE_URL}/messages`;
    const gen = streamChatCompletion(
      "key",
      { model: "claude-opus-4-7", messages: [], stream: true, max_tokens: 1024 },
      endpoint,
    );
    const results: unknown[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results.length).toBeGreaterThanOrEqual(4);
    expect(results[0]).toHaveProperty("type", "message_start");
    expect(results[2]).toMatchObject({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hello" },
    });
  });

  it("handles Anthropic native tool_use blocks", async () => {
    const events = [
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"msg_2","model":"claude-opus-4-7"}}',
      "",
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"read_file","input":{}}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"filePath\\":\\""}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"src/app.ts\\"}"}}',
      "",
      "event: content_block_stop",
      'data: {"type":"content_block_stop","index":0}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":15}}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(events),
    } as any);

    const endpoint = `${BASE_URL}/messages`;
    const gen = streamChatCompletion(
      "key",
      { model: "claude-opus-4-7", messages: [], stream: true, max_tokens: 1024 },
      endpoint,
    );
    const results: unknown[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    const toolUseStart = results.find(
      (r: any) => r.type === "content_block_start" && r.content_block?.type === "tool_use",
    ) as any;
    expect(toolUseStart).toBeDefined();
    expect(toolUseStart.content_block.name).toBe("read_file");
  });

  it("handles sparse SSE with empty lines between events", async () => {
    const events = [
      "",
      "event: message_start",
      "",
      'data: {"type":"message_start","message":{"id":"msg_3","model":"claude-opus-4-7"}}',
      "",
      "",
      "event: content_block_delta",
      "",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"test"}}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
      "",
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(events),
    } as any);

    const endpoint = `${BASE_URL}/messages`;
    const gen = streamChatCompletion(
      "key",
      { model: "claude-opus-4-7", messages: [], stream: true, max_tokens: 1024 },
      endpoint,
    );
    const results: unknown[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    const textDeltas = results.filter(
      (r: any) => r.type === "content_block_delta" && r.delta?.type === "text_delta",
    );
    expect(textDeltas).toHaveLength(1);
    expect((textDeltas[0] as any).delta.text).toBe("test");
  });

  it("skips event-only lines (no data: prefix)", async () => {
    const events = [
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"msg_4"}}',
      "",
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(events),
    } as any);

    const endpoint = `${BASE_URL}/messages`;
    const gen = streamChatCompletion(
      "key",
      { model: "claude-opus-4-7", messages: [], stream: true, max_tokens: 1024 },
      endpoint,
    );
    const results: unknown[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(3);
  });
});

describe("VCR: OpenAI SSE tool call delta chunks", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("yields raw tool call delta chunks as separate SSE events", async () => {
    const toolCallDeltas = [
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "kimi-k2.6",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  type: "function",
                  function: { name: "grep_search", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "kimi-k2.6",
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: "query" } }] },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "kimi-k2.6",
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: "=TODO" } }] },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "kimi-k2.6",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "tool_calls",
          },
        ],
      },
    ];

    const events = toolCallDeltas.map((d) => `data: ${JSON.stringify(d)}`);
    events.push("data: [DONE]");

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(events),
    } as any);

    const endpoint = `${BASE_URL}/chat/completions`;
    const gen = streamChatCompletion(
      "key",
      { model: "kimi-k2.6", messages: [], stream: true },
      endpoint,
    );
    const results: any[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    const toolDeltas = results.filter((r) => r.choices?.[0]?.delta?.tool_calls);
    expect(toolDeltas.length).toBeGreaterThanOrEqual(2);

    const finishChunk = results.find((r) => r.choices?.[0]?.finish_reason === "tool_calls");
    expect(finishChunk).toBeDefined();
  });

  it("yields text content alongside tool calls in stream", async () => {
    const events = [
      `data: ${JSON.stringify({
        id: "chatcmpl-2",
        object: "chat.completion.chunk",
        created: 1,
        model: "kimi-k2.6",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "Let me read that file." },
            finish_reason: null,
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-2",
        object: "chat.completion.chunk",
        created: 1,
        model: "kimi-k2.6",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_def",
                  type: "function",
                  function: { name: "read_file", arguments: '{"filePath":"/tmp/test.txt"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-2",
        object: "chat.completion.chunk",
        created: 1,
        model: "kimi-k2.6",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      })}`,
      "data: [DONE]",
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createSSEStream(events),
    } as any);

    const endpoint = `${BASE_URL}/chat/completions`;
    const gen = streamChatCompletion(
      "key",
      { model: "kimi-k2.6", messages: [], stream: true },
      endpoint,
    );
    const results: any[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    const textDeltas = results.filter(
      (r) => r.choices?.[0]?.delta?.content && !r.choices?.[0]?.delta?.tool_calls,
    );
    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas[0].choices[0].delta.content).toBe("Let me read that file.");

    const toolDeltas = results.filter((r) => r.choices?.[0]?.delta?.tool_calls);
    expect(toolDeltas.length).toBeGreaterThan(0);
    expect(toolDeltas[0].choices[0].delta.tool_calls[0].function.name).toBe("read_file");
  });
});

describe("VCR: parseTextEmbeddedToolCalls with realistic patterns", () => {
  it("parses JSON-fenced tool call from Hy3-style output", () => {
    const text =
      'I will read the file.\n\n```json\n[{"tool": "read_file", "parameters": {"filePath": "/src/app.ts", "startLine": 1, "endLine": 50}}]\n```';
    const result = parseTextEmbeddedToolCalls(text);

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ type: "text" });
    expect((result.segments[0] as any).text).toContain("I will read the file");
    expect(result.segments[1]).toMatchObject({ type: "toolCall" });
    expect((result.segments[1] as any).toolCall.name).toBe("read_file");
    expect((result.segments[1] as any).toolCall.args).toMatchObject({
      filePath: "/src/app.ts",
      startLine: 1,
      endLine: 50,
    });
  });

  it("parses compact XML-style tool call", () => {
    const text =
      '<tool_call>read_file filePath="/src/app.ts" startLine="1" endLine="50"</tool_call>';
    const result = parseTextEmbeddedToolCalls(text);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe("toolCall");
    expect((result.segments[0] as any).toolCall.name).toBe("read_file");
    expect((result.segments[0] as any).toolCall.args).toMatchObject({
      filePath: "/src/app.ts",
      startLine: 1,
      endLine: 50,
    });
  });

  it("parses tool_sep style tool call", () => {
    const text =
      "<tool_call>runSubagent<tool_sep><arg_key>agentName</arg_key><arg_value>explore</arg_value><arg_key>prompt</arg_key><arg_value>Find all test files</arg_value></tool_call>";
    const result = parseTextEmbeddedToolCalls(text);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe("toolCall");
    expect((result.segments[0] as any).toolCall.name).toBe("runSubagent");
    expect((result.segments[0] as any).toolCall.args).toMatchObject({
      agentName: "explore",
      prompt: "Find all test files",
    });
  });

  it("handles mixed text and multiple tool calls", () => {
    const text = [
      "Let me check two things.",
      '<tool_call>read_file filePath="/src/a.ts"</tool_call>',
      "Now the second one:",
      '<tool_call>grep_search pattern="TODO" filePath="/src/"</tool_call>',
    ].join("\n");
    const result = parseTextEmbeddedToolCalls(text);

    const textSegments = result.segments.filter((s) => s.type === "text");
    const toolSegments = result.segments.filter((s) => s.type === "toolCall");

    expect(textSegments.length).toBeGreaterThanOrEqual(2);
    expect(toolSegments).toHaveLength(2);
    expect((toolSegments[0] as any).toolCall.name).toBe("read_file");
    expect((toolSegments[1] as any).toolCall.name).toBe("grep_search");
  });

  it("handles incomplete tool call at end of buffer", () => {
    const text = 'Some text <tool_call>read_file filePath="/src';
    const result = parseTextEmbeddedToolCalls(text);

    const textSegments = result.segments.filter((s) => s.type === "text");
    expect(textSegments).toHaveLength(1);
    expect((textSegments[0] as any).text).toBe("Some text ");
    expect(result.incompleteText).toBe('<tool_call>read_file filePath="/src');
  });

  it("parses legacy token-based tool call format", () => {
    const text =
      'Let me search.<|tool_call_begin|>grep_search<|tool_call_argument_begin|>{"query":"TODO","isRegexp":false}<|tool_call_end|>';
    const result = parseTextEmbeddedToolCalls(text);

    expect(result.segments).toHaveLength(2);
    expect(result.segments[1].type).toBe("toolCall");
    expect((result.segments[1] as any).toolCall.name).toBe("grep_search");
    expect((result.segments[1] as any).toolCall.args).toMatchObject({
      query: "TODO",
      isRegexp: false,
    });
  });

  it("returns plain text when no tool markers exist", () => {
    const text = "This is just a normal response with no tool calls.";
    const result = parseTextEmbeddedToolCalls(text);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe("text");
    expect((result.segments[0] as any).text).toBe(text);
    expect(result.incompleteText).toBe("");
  });
});
