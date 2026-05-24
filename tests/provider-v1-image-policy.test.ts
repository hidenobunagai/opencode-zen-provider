import * as vscode from "vscode";
import { streamChatCompletion } from "../src/api";
import { ZenChatModelProvider } from "../src/provider";

jest.mock("../src/api", () => ({
  streamChatCompletion: jest.fn(() => {
    async function* gen() {
      yield { id: "1", choices: [{ delta: { content: "Mock response" } }] };
    }
    return gen();
  }),
  fetchWithRetry: jest.fn(),
  resolveApiEndpoint: jest.fn(() => "https://opencode.ai/zen/v1/chat/completions"),
}));

jest.mock("vscode", () => ({
  SecretStorage: class {},
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  CancellationError: class extends Error {},
  EventEmitter: class {
    event = jest.fn();
    fire = jest.fn();
  },
  LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 0 },
  LanguageModelChatMessage: {
    User: jest.fn((content) => ({ role: 1, content })),
    Assistant: jest.fn((content) => ({ role: 2, content })),
  },
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    showInputBox: jest.fn(),
  },
}));

describe("OpenCode Zen V1 image policy", () => {
  it("switches to vision fallback model when image input is provided for non-vision model", async () => {
    const secrets = {
      get: jest.fn().mockResolvedValue("test-key"),
      store: jest.fn(),
      delete: jest.fn(),
      onDidChange: jest.fn(),
    } as unknown as vscode.SecretStorage;
    const provider = new ZenChatModelProvider(secrets, "test-ua");
    const progress = { report: jest.fn() };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };

    await provider.provideLanguageModelChatResponse(
      { id: "minimax-m2.5", maxInputTokens: 100000, maxOutputTokens: 65536 } as any,
      [
        {
          role: 1,
          content: [
            { value: "What is in this image?" },
            { mimeType: "image/png", data: new Uint8Array([1, 2, 3]) },
          ],
        },
      ] as any,
      { modelOptions: {} } as any,
      progress,
      token as any,
    );

    // Should switch to fallback (gemini-3-flash or other vision model)
    // and report the switch to progress, then invoke streamChatCompletion.
    expect(progress.report).toHaveBeenCalledWith(
      expect.objectContaining({
        value: expect.stringContaining("Switching to"),
      }),
    );
    expect(streamChatCompletion).toHaveBeenCalled();
  });
});
