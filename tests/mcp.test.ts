import type * as vscode from "vscode";
import { requestChatCompletion, resolveApiEndpoint } from "../src/api";
import { ZenMcpClient } from "../src/mcp";

jest.mock("../src/api", () => ({
  requestChatCompletion: jest.fn(),
  resolveApiEndpoint: jest.fn(() => "https://opencode.ai/zen/v1/models/gemini-3-flash"),
}));

const VISION_MODEL = "gemini-3-flash";
const IMAGE_DATA = "data:image/png;base64,AAAA";
const ENDPOINT = "https://opencode.ai/zen/v1/models/gemini-3-flash";

function createSecrets(storedValue?: string) {
  const get = jest.fn().mockResolvedValue(storedValue);
  return { secrets: { get } as unknown as vscode.SecretStorage, get };
}

describe("ZenMcpClient.analyzeImage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the request-scoped key, posts the image and returns trimmed content", async () => {
    const { secrets, get } = createSecrets("stored-key");
    const client = new ZenMcpClient(secrets, "test-agent");
    (requestChatCompletion as jest.Mock).mockResolvedValueOnce({
      choices: [{ message: { content: "  A red square.  " } }],
    });

    const result = await client.analyzeImage(IMAGE_DATA, "What is this?", undefined, "  scoped  ");

    expect(result).toBe("A red square.");
    expect(get).not.toHaveBeenCalled();
    expect(resolveApiEndpoint).toHaveBeenCalledWith("model_specific", VISION_MODEL);
    expect(requestChatCompletion).toHaveBeenCalledTimes(1);
    const [apiKey, body, endpoint, signal, userAgent] = (requestChatCompletion as jest.Mock).mock
      .calls[0];
    expect(apiKey).toBe("scoped");
    expect(endpoint).toBe(ENDPOINT);
    expect(signal).toBeUndefined();
    expect(userAgent).toBe("test-agent");
    expect(body).toEqual({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: IMAGE_DATA } },
          ],
        },
      ],
      max_tokens: 2000,
    });
  });

  it("falls back to the stored key and forwards the abort signal", async () => {
    const { secrets, get } = createSecrets("  stored-key  ");
    const client = new ZenMcpClient(secrets);
    (requestChatCompletion as jest.Mock).mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
    });
    const controller = new AbortController();

    await client.analyzeImage(IMAGE_DATA, "prompt", controller.signal);

    expect(get).toHaveBeenCalledWith("opencode-zen.apiKey");
    const [apiKey, , , signal, userAgent] = (requestChatCompletion as jest.Mock).mock.calls[0];
    expect(apiKey).toBe("stored-key");
    expect(signal).toBe(controller.signal);
    expect(userAgent).toBeUndefined();
  });

  it("ignores a blank request-scoped key and reads SecretStorage instead", async () => {
    const { secrets, get } = createSecrets("stored-key");
    const client = new ZenMcpClient(secrets);
    (requestChatCompletion as jest.Mock).mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
    });

    await client.analyzeImage(IMAGE_DATA, "prompt", undefined, "   ");

    expect(get).toHaveBeenCalledWith("opencode-zen.apiKey");
    expect((requestChatCompletion as jest.Mock).mock.calls[0][0]).toBe("stored-key");
  });

  it("throws before calling the API when no key is available", async () => {
    const { secrets } = createSecrets(undefined);
    const client = new ZenMcpClient(secrets);

    await expect(client.analyzeImage(IMAGE_DATA, "prompt")).rejects.toThrow(
      "OpenCode Zen API key not found",
    );
    expect(requestChatCompletion).not.toHaveBeenCalled();
  });

  it("throws when the vision model returns no content", async () => {
    const { secrets } = createSecrets("stored-key");
    const client = new ZenMcpClient(secrets);
    (requestChatCompletion as jest.Mock).mockResolvedValueOnce({
      choices: [{ message: { content: "   " } }],
    });

    await expect(client.analyzeImage(IMAGE_DATA, "prompt")).rejects.toThrow(
      "Vision API returned no message content",
    );
  });
});
