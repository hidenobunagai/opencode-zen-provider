import * as vscode from "vscode";

describe("tokenizer", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("estimates Latin tokens at ~2 chars per token", () => {
    jest.isolateModules(() => {
      const { estimateTokens } = require("../src/tokenizer") as typeof import("../src/tokenizer");
      // 100 Latin chars / 2 = 50 tokens
      expect(estimateTokens("a".repeat(100), "claude-opus-4-7")).toBe(50);
      expect(estimateTokens("a".repeat(100), "gpt-5.4")).toBe(50);
      expect(estimateTokens("a".repeat(100), "gemini-3-flash")).toBe(50);
    });
  });

  it("estimates CJK chars as ~1 token each", () => {
    jest.isolateModules(() => {
      const { estimateTokens } = require("../src/tokenizer") as typeof import("../src/tokenizer");
      // CJK chars count as ~1 token each
      expect(estimateTokens("中".repeat(100), "kimi-k2.6")).toBe(100);
      expect(estimateTokens("中".repeat(100), "qwen3.6-plus")).toBe(100);
      expect(estimateTokens("こんにちは".repeat(20), "gpt-5.5")).toBe(100);
    });
  });

  it("estimates full-width chars as ~1 token each", () => {
    jest.isolateModules(() => {
      const { estimateTokens } = require("../src/tokenizer") as typeof import("../src/tokenizer");
      // Full-width characters count as ~1 token each
      expect(estimateTokens("ＡＢＣ".repeat(30), "gpt-5.5")).toBe(90);
    });
  });

  it("handles mixed content", () => {
    jest.isolateModules(() => {
      const { estimateTokens } = require("../src/tokenizer") as typeof import("../src/tokenizer");
      // 8 Latin chars = 4 tokens, 4 CJK chars = 4 tokens = 8 total
      expect(estimateTokens("abcdefgh中日月火", "gpt-5.5")).toBe(8);
    });
  });

  it("estimates tokens for tool call parts from tool name and json arguments", () => {
    jest.isolateModules(() => {
      const { estimateMessagesTokens, estimateTokens } =
        require("../src/tokenizer") as typeof import("../src/tokenizer");
      const toolCallPart = new vscode.LanguageModelToolCallPart("call_1", "read_file", {
        path: "src/index.ts",
      });
      const messages = [{ content: [toolCallPart] }];

      const expectedToolNameTokens = estimateTokens("read_file");
      const expectedArgsTokens = estimateTokens(JSON.stringify({ path: "src/index.ts" }));
      const expectedTotal = expectedToolNameTokens + expectedArgsTokens;

      expect(expectedTotal).toBeGreaterThan(0);
      expect(estimateMessagesTokens(messages, "gpt-5.5")).toBe(expectedTotal);
    });
  });

  it("estimates tokens accurately for tool result parts containing large file content", () => {
    jest.isolateModules(() => {
      const { estimateMessagesTokens, estimateTokens } =
        require("../src/tokenizer") as typeof import("../src/tokenizer");
      const largeFileContent = "const x = 1;\n".repeat(200);
      const toolResultPart = new vscode.LanguageModelToolResultPart("call_1", [
        new vscode.LanguageModelTextPart(largeFileContent),
      ]);
      const messages = [{ content: [toolResultPart] }];

      const expectedTokens = estimateTokens(largeFileContent);
      expect(expectedTokens).toBeGreaterThan(100);
      expect(estimateMessagesTokens(messages, "gpt-5.5")).toBe(expectedTokens);
    });
  });

  it("sums tokens across mixed multi-turn conversations with text, tool calls, and tool results", () => {
    jest.isolateModules(() => {
      const { estimateMessagesTokens, estimateTokens } =
        require("../src/tokenizer") as typeof import("../src/tokenizer");
      const userText = "Please inspect the file.";
      const toolName = "read_file";
      const toolArgs = { path: "src/index.ts" };
      const toolResultText = "export const answer = 42;\n".repeat(50);
      const assistantText = "I found the answer.";

      const messages = [
        { content: [new vscode.LanguageModelTextPart(userText)] },
        { content: [new vscode.LanguageModelToolCallPart("call_1", toolName, toolArgs)] },
        {
          content: [
            new vscode.LanguageModelToolResultPart("call_1", [
              new vscode.LanguageModelTextPart(toolResultText),
            ]),
          ],
        },
        { content: [new vscode.LanguageModelTextPart(assistantText)] },
      ];

      const expectedTotal =
        estimateTokens(userText) +
        estimateTokens(toolName) +
        estimateTokens(JSON.stringify(toolArgs)) +
        estimateTokens(toolResultText) +
        estimateTokens(assistantText);

      expect(estimateMessagesTokens(messages, "gpt-5.5")).toBe(expectedTotal);
    });
  });

  it("adds fixed estimated tokens for image data parts", () => {
    jest.isolateModules(() => {
      const { estimateMessagesTokens } =
        require("../src/tokenizer") as typeof import("../src/tokenizer");
      const imagePart = {
        mimeType: "image/png",
        data: new Uint8Array([1, 2, 3, 4]),
      };
      const messages = [{ content: [imagePart] }];
      expect(estimateMessagesTokens(messages, "gpt-5.5")).toBe(1000);
    });
  });
});
