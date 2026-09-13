import * as vscode from "vscode";
import { registerZenTools, ZenAnalyzeImageTool } from "../src/tools";

const mockAnalyzeImage = jest.fn();

jest.mock("../src/mcp", () => ({
  ZenMcpClient: jest.fn(() => ({ analyzeImage: mockAnalyzeImage })),
}));

jest.mock("vscode", () => ({
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  LanguageModelToolResult: class {
    constructor(public content: unknown[]) {}
  },
  CancellationError: class CancellationError extends Error {
    constructor() {
      super("Canceled");
      this.name = "CancellationError";
    }
  },
  Disposable: { from: jest.fn(() => ({ dispose: jest.fn() })) },
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) },
}));

const OPTIONS = {
  input: { image_data: "data:image/png;base64,AAAA", prompt: "What is this?" },
} as vscode.LanguageModelToolInvocationOptions<{ image_data: string; prompt: string }>;

function createToken() {
  let cancellationCallback: (() => void) | undefined;
  const dispose = jest.fn();
  const onCancellationRequested = jest.fn((callback: () => void) => {
    cancellationCallback = callback;
    return { dispose };
  });
  return {
    token: { onCancellationRequested } as unknown as vscode.CancellationToken,
    triggerCancellation: () => cancellationCallback?.(),
    dispose,
  };
}

const textOf = (result: vscode.LanguageModelToolResult): string =>
  (result.content[0] as vscode.LanguageModelTextPart).value;

describe("ZenAnalyzeImageTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the analysis and disposes the cancellation subscription", async () => {
    const tool = new ZenAnalyzeImageTool({} as vscode.SecretStorage, "test-agent");
    const { token, dispose } = createToken();
    mockAnalyzeImage.mockResolvedValueOnce("A red square.");

    const result = await tool.invoke(OPTIONS, token);

    expect(textOf(result)).toBe("A red square.");
    expect(mockAnalyzeImage).toHaveBeenCalledWith(
      OPTIONS.input.image_data,
      OPTIONS.input.prompt,
      expect.any(AbortSignal),
    );
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("turns a cancellation into a CancellationError", async () => {
    const tool = new ZenAnalyzeImageTool({} as vscode.SecretStorage);
    const { token, triggerCancellation, dispose } = createToken();
    mockAnalyzeImage.mockImplementation(
      (_imageData: string, _prompt: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const pending = tool.invoke(OPTIONS, token);
    triggerCancellation();

    await expect(pending).rejects.toBeInstanceOf(vscode.CancellationError);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reports a failed analysis as tool output instead of throwing", async () => {
    const tool = new ZenAnalyzeImageTool({} as vscode.SecretStorage);
    const { token } = createToken();
    mockAnalyzeImage.mockRejectedValueOnce(new Error("OpenCode Zen API key not found"));

    const result = await tool.invoke(OPTIONS, token);

    expect(textOf(result)).toBe("Failed to analyze image: OpenCode Zen API key not found");
  });

  it("falls back to a generic message for non-Error rejections", async () => {
    const tool = new ZenAnalyzeImageTool({} as vscode.SecretStorage);
    const { token } = createToken();
    mockAnalyzeImage.mockRejectedValueOnce("boom");

    const result = await tool.invoke(OPTIONS, token);

    expect(textOf(result)).toBe("Failed to analyze image: Unknown error");
  });

  it("announces the invocation when the host asks for a prepared message", () => {
    const tool = new ZenAnalyzeImageTool({} as vscode.SecretStorage);

    expect(tool.prepareInvocation?.(OPTIONS, createToken().token)).toEqual({
      invocationMessage: "Analyzing image with OpenCode Zen Vision...",
    });
  });
});

describe("registerZenTools", () => {
  it("registers the analyze-image tool under its published id", () => {
    const secrets = {} as vscode.SecretStorage;

    const disposable = registerZenTools(secrets, "test-agent");

    expect(vscode.lm.registerTool).toHaveBeenCalledWith(
      ZenAnalyzeImageTool.id,
      expect.any(ZenAnalyzeImageTool),
    );
    expect(disposable).toEqual({ dispose: expect.any(Function) });
  });
});
