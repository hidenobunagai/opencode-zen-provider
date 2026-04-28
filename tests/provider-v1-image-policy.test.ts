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
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  CancellationError: class extends Error {},
  EventEmitter: class {
    event = jest.fn();
    fire = jest.fn();
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
  it("rejects image input for non-vision models instead of silently falling back", async () => {
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

    await expect(
      provider.provideLanguageModelChatResponse(
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
      ),
    ).rejects.toThrow(/image input/i);

    expect(streamChatCompletion).not.toHaveBeenCalled();
  });
});
