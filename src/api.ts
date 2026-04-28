import { BASE_RETRY_DELAY_MS, BASE_URL, MAX_RETRY_DELAY_MS } from "./constants";
import { debugLog } from "./output-channel";
import {
  OcGoChatCompletionResponse,
  OcGoChatRequest,
  OcGoGeminiRequest,
  OcGoResponsesRequest,
  OcGoResponsesResponse,
  OcGoStreamResponse,
} from "./types";

/**
 * Determine whether an HTTP status code is safe to retry.
 * Retries on 429 (rate limit), 502, 503, 504 (server errors).
 * Never retries on 400, 401, 403, 404, 422 (client errors).
 */
function isRetryableHttpError(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Read Retry-After header value (seconds) if present.
 */
function getRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  return undefined;
}

/**
 * Calculate delay with exponential backoff and full jitter.
 * This prevents thundering herd when multiple clients retry simultaneously.
 */
function calculateRetryDelay(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined && retryAfter > 0) {
    // Add jitter to server-provided retry-after (±25%)
    // Do not cap server-provided retry-after with MAX_RETRY_DELAY_MS
    const jitter = retryAfter * 0.25 * (Math.random() * 2 - 1);
    return Math.max(Math.round(retryAfter + jitter), 0);
  }

  const exponentialDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
  // Full jitter: random delay between 0 and cappedDelay
  return Math.round(Math.random() * cappedDelay);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || !isRetryableHttpError(response.status)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      if (i < retries - 1) {
        const retryAfter = getRetryAfterMs(response);
        const delay = calculateRetryDelay(i, retryAfter);
        debugLog(
          "fetchWithRetry",
          `Attempt ${i + 1} failed with ${response.status}, retrying after ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === "AbortError") {
        throw lastError;
      }
      if (i < retries - 1) {
        const delay = calculateRetryDelay(i);
        debugLog(
          "fetchWithRetry",
          `Attempt ${i + 1} failed with network error, retrying after ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError ?? new Error("Network request failed after retries");
}

function buildRequestHeaders(apiKey: string, userAgent?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(userAgent ? { "User-Agent": userAgent } : {}),
  };
}

function buildGeminiRequestHeaders(apiKey: string, userAgent?: string): Record<string, string> {
  return {
    "x-goog-api-key": apiKey,
    "Content-Type": "application/json",
    ...(userAgent ? { "User-Agent": userAgent } : {}),
  };
}

async function createChatCompletionResponse(
  apiKey: string,
  requestBody: OcGoChatRequest,
  signal?: AbortSignal,
  userAgent?: string,
): Promise<Response> {
  return fetchWithRetry(
    `${BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: buildRequestHeaders(apiKey, userAgent),
      body: JSON.stringify(requestBody),
      signal,
    },
    5,
  );
}

async function createResponsesResponse(
  apiKey: string,
  requestBody: OcGoResponsesRequest,
  signal?: AbortSignal,
  userAgent?: string,
): Promise<Response> {
  return fetchWithRetry(
    `${BASE_URL}/responses`,
    {
      method: "POST",
      headers: buildRequestHeaders(apiKey, userAgent),
      body: JSON.stringify(requestBody),
      signal,
    },
    5,
  );
}

async function createGeminiResponse(
  apiKey: string,
  modelId: string,
  requestBody: OcGoGeminiRequest,
  signal?: AbortSignal,
  userAgent?: string,
): Promise<Response> {
  return fetchWithRetry(
    `${BASE_URL}/models/${modelId}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: buildGeminiRequestHeaders(apiKey, userAgent),
      body: JSON.stringify(requestBody),
      signal,
    },
    5,
  );
}

async function throwApiError(response: Response): Promise<never> {
  const text = await response.text();
  let message = `OpenCode Zen API error: ${response.status} ${response.statusText}`;
  if (response.status === 401 || response.status === 403) {
    message = `Authentication failed. Your API key may be invalid or expired.\n${message}`;
  } else if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    message = `Rate limited. ${retryAfter ? `Retry after ${retryAfter}s. ` : ""}\n${message}`;
  } else if (response.status >= 500 && response.status < 600) {
    message = `Server error. The OpenCode Zen service may be experiencing issues.\n${message}`;
  }
  throw new Error(`${message}\n${text}`);
}

export async function requestChatCompletion(
  apiKey: string,
  requestBody: OcGoChatRequest,
  signal?: AbortSignal,
  userAgent?: string,
): Promise<OcGoChatCompletionResponse> {
  const response = await createChatCompletionResponse(apiKey, requestBody, signal, userAgent);
  if (!response.ok) {
    await throwApiError(response);
  }
  return (await response.json()) as OcGoChatCompletionResponse;
}

export async function requestResponse(
  apiKey: string,
  requestBody: OcGoResponsesRequest,
  signal?: AbortSignal,
  userAgent?: string,
): Promise<OcGoResponsesResponse> {
  const response = await createResponsesResponse(apiKey, requestBody, signal, userAgent);
  if (!response.ok) {
    await throwApiError(response);
  }
  return (await response.json()) as OcGoResponsesResponse;
}

export async function* streamChatCompletion(
  apiKey: string,
  requestBody: OcGoChatRequest,
  signal?: AbortSignal,
  userAgent?: string,
): AsyncGenerator<OcGoStreamResponse, void, unknown> {
  const response = await createChatCompletionResponse(apiKey, requestBody, signal, userAgent);

  if (!response.ok) {
    await throwApiError(response);
  }

  if (!response.body) {
    throw new Error("No response body from OpenCode Zen API");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let malformedSseCount = 0;
  const MALFORMED_SSE_WARN_THRESHOLD = 10;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as OcGoStreamResponse;
          yield parsed;
        } catch {
          malformedSseCount++;
          debugLog("streamChatCompletion", `Malformed SSE line: ${data.slice(0, 200)}`);
        }
      }
    }

    // Flush decoder internal state and process any remaining lines
    const remaining = decoder.decode();
    buffer += remaining;
    const finalLines = buffer.split("\n");
    for (const line of finalLines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as OcGoStreamResponse;
        yield parsed;
      } catch {
        malformedSseCount++;
        debugLog("streamChatCompletion", `Malformed SSE line: ${data.slice(0, 200)}`);
      }
    }

    if (malformedSseCount >= MALFORMED_SSE_WARN_THRESHOLD) {
      debugLog(
        "streamChatCompletion",
        `Received ${malformedSseCount} malformed SSE lines (threshold: ${MALFORMED_SSE_WARN_THRESHOLD})`,
      );
    }
  } finally {
    reader.releaseLock();
  }
}

interface SseEvent {
  event?: string;
  data: string;
}

function parseSseEventBlock(block: string): SseEvent | undefined {
  const dataLines: string[] = [];
  let event: string | undefined;

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.search(/\r?\n\r?\n/);
      while (separatorIndex !== -1) {
        const separator = buffer.startsWith("\r\n\r\n", separatorIndex) ? 4 : 2;
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + separator);
        const parsed = parseSseEventBlock(block);
        if (parsed) {
          yield parsed;
        }
        separatorIndex = buffer.search(/\r?\n\r?\n/);
      }
    }

    buffer += decoder.decode();
    const parsed = parseSseEventBlock(buffer);
    if (parsed) {
      yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function normalizeResponsesEvent(
  eventType: string | undefined,
  payload: Record<string, unknown>,
  fallbackModel: string,
): OcGoStreamResponse | undefined {
  const type = typeof payload.type === "string" ? payload.type : eventType;
  const outputIndex = typeof payload.output_index === "number" ? payload.output_index : 0;
  const responseId = typeof payload.response_id === "string" ? payload.response_id : "response";
  const model = typeof payload.model === "string" ? payload.model : fallbackModel;

  if (
    (type === "response.output_text.delta" || type === "response.text.delta") &&
    typeof payload.delta === "string"
  ) {
    return {
      id: responseId,
      object: "response.chunk",
      created: Date.now(),
      model,
      choices: [{ index: outputIndex, delta: { content: payload.delta }, finish_reason: null }],
    };
  }

  if (
    (type === "response.reasoning_text.delta" ||
      type === "response.reasoning_summary_text.delta") &&
    typeof payload.delta === "string"
  ) {
    return {
      id: responseId,
      object: "response.chunk",
      created: Date.now(),
      model,
      choices: [
        { index: outputIndex, delta: { reasoning_content: payload.delta }, finish_reason: null },
      ],
    };
  }

  if (
    type === "response.function_call_arguments.done" &&
    typeof payload.call_id === "string" &&
    typeof payload.name === "string" &&
    typeof payload.arguments === "string"
  ) {
    return {
      id: responseId,
      object: "response.chunk",
      created: Date.now(),
      model,
      choices: [
        {
          index: outputIndex,
          delta: {
            tool_calls: [
              {
                id: payload.call_id,
                index: outputIndex,
                type: "function",
                function: {
                  name: payload.name,
                  arguments: payload.arguments,
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
  }

  return undefined;
}

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeGeminiUsage(payload: Record<string, unknown>) {
  const usageMetadata = asObjectRecord(payload.usageMetadata);
  if (!usageMetadata) {
    return undefined;
  }

  const promptTokens =
    typeof usageMetadata.promptTokenCount === "number" ? usageMetadata.promptTokenCount : undefined;
  const completionTokens =
    typeof usageMetadata.candidatesTokenCount === "number"
      ? usageMetadata.candidatesTokenCount
      : undefined;
  const totalTokens =
    typeof usageMetadata.totalTokenCount === "number" ? usageMetadata.totalTokenCount : undefined;

  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function normalizeGeminiPayload(
  payload: Record<string, unknown>,
  fallbackModel: string,
): OcGoStreamResponse[] {
  const responseId = typeof payload.responseId === "string" ? payload.responseId : "response";
  const model = typeof payload.modelVersion === "string" ? payload.modelVersion : fallbackModel;
  const usage = normalizeGeminiUsage(payload);
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const normalized: OcGoStreamResponse[] = [];

  for (const [candidateIndex, candidateValue] of candidates.entries()) {
    const candidate = asObjectRecord(candidateValue);
    if (!candidate) {
      continue;
    }

    const index = typeof candidate.index === "number" ? candidate.index : candidateIndex;
    const content = asObjectRecord(candidate.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const textSegments: string[] = [];
    const toolCalls = parts.flatMap((partValue, partIndex) => {
      const part = asObjectRecord(partValue);
      if (!part) {
        return [];
      }

      if (typeof part.text === "string" && part.text.length > 0) {
        textSegments.push(part.text);
      }

      const functionCall = asObjectRecord(part.functionCall);
      if (!functionCall || typeof functionCall.name !== "string") {
        return [];
      }

      return [
        {
          id:
            typeof functionCall.id === "string"
              ? functionCall.id
              : `${responseId}_tool_${index}_${partIndex}`,
          index: partIndex,
          type: "function" as const,
          function: {
            name: functionCall.name,
            arguments: JSON.stringify(functionCall.args ?? {}),
          },
        },
      ];
    });

    if (textSegments.length === 0 && toolCalls.length === 0) {
      continue;
    }

    normalized.push({
      id: responseId,
      object: "response.chunk",
      created: Date.now(),
      model,
      choices: [
        {
          index,
          delta: {
            ...(textSegments.length > 0 ? { content: textSegments.join("") } : {}),
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: null,
        },
      ],
      ...(usage ? { usage } : {}),
    });
  }

  return normalized;
}

export async function* streamResponses(
  apiKey: string,
  requestBody: OcGoResponsesRequest,
  signal?: AbortSignal,
  userAgent?: string,
): AsyncGenerator<OcGoStreamResponse, void, unknown> {
  const response = await createResponsesResponse(apiKey, requestBody, signal, userAgent);

  if (!response.ok) {
    await throwApiError(response);
  }

  if (!response.body) {
    throw new Error("No response body from OpenCode Zen API");
  }

  let malformedSseCount = 0;
  const MALFORMED_SSE_WARN_THRESHOLD = 10;

  for await (const event of readSseEvents(response.body)) {
    if (event.data === "[DONE]") {
      continue;
    }

    try {
      const payload = JSON.parse(event.data) as Record<string, unknown>;
      const normalized = normalizeResponsesEvent(event.event, payload, requestBody.model);
      if (normalized) {
        yield normalized;
      }
    } catch {
      malformedSseCount++;
      debugLog("streamResponses", `Malformed SSE payload: ${event.data.slice(0, 200)}`);
    }
  }

  if (malformedSseCount >= MALFORMED_SSE_WARN_THRESHOLD) {
    debugLog(
      "streamResponses",
      `Received ${malformedSseCount} malformed SSE lines (threshold: ${MALFORMED_SSE_WARN_THRESHOLD})`,
    );
  }
}

export async function* streamGeminiContent(
  apiKey: string,
  modelId: string,
  requestBody: OcGoGeminiRequest,
  signal?: AbortSignal,
  userAgent?: string,
): AsyncGenerator<OcGoStreamResponse, void, unknown> {
  const response = await createGeminiResponse(apiKey, modelId, requestBody, signal, userAgent);

  if (!response.ok) {
    await throwApiError(response);
  }

  if (!response.body) {
    throw new Error("No response body from OpenCode Zen API");
  }

  let malformedSseCount = 0;
  const MALFORMED_SSE_WARN_THRESHOLD = 10;

  for await (const event of readSseEvents(response.body)) {
    if (event.data === "[DONE]") {
      continue;
    }

    try {
      const payload = JSON.parse(event.data) as Record<string, unknown>;
      for (const normalized of normalizeGeminiPayload(payload, modelId)) {
        yield normalized;
      }
    } catch {
      malformedSseCount++;
      debugLog("streamGeminiContent", `Malformed SSE payload: ${event.data.slice(0, 200)}`);
    }
  }

  if (malformedSseCount >= MALFORMED_SSE_WARN_THRESHOLD) {
    debugLog(
      "streamGeminiContent",
      `Received ${malformedSseCount} malformed SSE lines (threshold: ${MALFORMED_SSE_WARN_THRESHOLD})`,
    );
  }
}
