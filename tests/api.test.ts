import { fetchWithRetry, streamChatCompletion } from "../src/api";
import { BASE_URL } from "../src/constants";
import { ZenStreamResponse } from "../src/types";

describe("fetchWithRetry", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the response on success", async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as any;
    global.fetch = jest.fn().mockResolvedValue({
      ...response,
    });

    const result = await fetchWithRetry(`${BASE_URL}/models`, {
      method: "GET",
      headers: { Authorization: "Bearer test-key" },
    });
    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/models`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
  });

  it("returns the first non-retryable failure response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as any);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns a 429 response immediately when Retry-After exceeds the limit", async () => {
    const response = {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers({ "retry-after": "3600" }),
    } as any;
    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock;
    jest.useFakeTimers();

    try {
      let result: Response | undefined;
      let rejection: unknown;
      const observedRequest = fetchWithRetry(`${BASE_URL}/models`, { method: "GET" }).then(
        (value) => {
          result = value;
        },
        (error: unknown) => {
          rejection = error;
        },
      );

      await jest.advanceTimersByTimeAsync(0);
      const timerCount = jest.getTimerCount();
      jest.clearAllTimers();

      expect(timerCount).toBe(0);
      await observedRequest;
      expect(result).toBe(response);
      expect(rejection).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("aborts an in-progress Retry-After wait without retrying", async () => {
    const response = {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers({ "retry-after": "60" }),
    } as any;
    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock;
    const controller = new AbortController();
    const abortError = new Error("Request aborted");
    abortError.name = "AbortError";
    jest.useFakeTimers();

    try {
      const requestOutcome = fetchWithRetry(`${BASE_URL}/models`, {
        method: "GET",
        signal: controller.signal,
      }).then(
        (value) => ({ status: "resolved" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );

      await jest.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(1);

      controller.abort(abortError);
      const abortDeadline = new Promise<{ status: "pending" }>((resolve) => {
        setTimeout(() => resolve({ status: "pending" }), 0);
      });
      await jest.advanceTimersByTimeAsync(0);
      const outcome = await Promise.race([requestOutcome, abortDeadline]);

      expect(jest.getTimerCount()).toBe(0);
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.error).toBe(abortError);
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe("streamChatCompletion", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("yields parsed SSE chunks", async () => {
    const chunk: ZenStreamResponse = {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "kimi-k2.6",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const endpoint = `${BASE_URL}/chat/completions`;
    const gen = streamChatCompletion(
      "key",
      { model: "kimi-k2.6", messages: [], stream: true },
      endpoint,
    );
    const results: ZenStreamResponse[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(1);
    expect(results[0].choices[0].delta.content).toBe("Hello");
  });

  it("throws on non-ok response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Server error",
    } as any);

    const endpoint = `${BASE_URL}/chat/completions`;
    const gen = streamChatCompletion(
      "key",
      { model: "kimi-k2.6", messages: [], stream: true },
      endpoint,
    );
    await expect(gen.next()).rejects.toThrow("OpenCode Zen server error (500)");
  });

  it("throws authentication error on 401", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid key",
    } as any);

    const endpoint = `${BASE_URL}/chat/completions`;
    const gen = streamChatCompletion(
      "key",
      { model: "kimi-k2.6", messages: [], stream: true },
      endpoint,
    );
    await expect(gen.next()).rejects.toThrow("OpenCode Zen API authentication failed (401)");
  });

  it("retries on 429 and eventually throws after exhausting retries", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: (name: string) => (name === "retry-after" ? "0" : null) },
      text: async () => "Rate limited",
    } as any);

    const endpoint = `${BASE_URL}/chat/completions`;
    const gen = streamChatCompletion(
      "key",
      { model: "kimi-k2.6", messages: [], stream: true },
      endpoint,
    );
    await expect(gen.next()).rejects.toThrow("HTTP 429");
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("retries on network failure and succeeds", async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as any;
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(response);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries up to 3 times then throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    await expect(fetchWithRetry(`${BASE_URL}/models`, { method: "GET" })).rejects.toThrow(
      "Network error",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("retries on 429 with Retry-After then succeeds", async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as any;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name === "retry-after" ? "1" : null) },
      } as any)
      .mockResolvedValueOnce(response);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 then succeeds", async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as any;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: { get: () => null },
      } as any)
      .mockResolvedValueOnce(response);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 401", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as any);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("handles partial lines across chunks", async () => {
    const chunk: ZenStreamResponse = {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "kimi-k2.6",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    };
    const encoder = new TextEncoder();
    const jsonStr = JSON.stringify(chunk);
    const part1 = `data: ${jsonStr.slice(0, 10)}`;
    const part2 = `${jsonStr.slice(10)}\n\n`;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(part1));
        controller.enqueue(encoder.encode(part2));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const endpoint = `${BASE_URL}/chat/completions`;
    const gen = streamChatCompletion(
      "key",
      { model: "kimi-k2.6", messages: [], stream: true },
      endpoint,
    );
    const results: ZenStreamResponse[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(1);
    expect(results[0].choices[0].delta.content).toBe("Hello");
  });

  it("skips malformed JSON lines", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {invalid json}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const endpoint = `${BASE_URL}/chat/completions`;
    const gen = streamChatCompletion(
      "key",
      { model: "kimi-k2.6", messages: [], stream: true },
      endpoint,
    );
    const results: ZenStreamResponse[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(0);
  });
});
