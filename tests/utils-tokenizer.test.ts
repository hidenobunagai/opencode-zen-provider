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
});
