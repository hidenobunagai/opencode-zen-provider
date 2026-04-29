describe("utils tokenizer fallback", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock("@dqbd/tiktoken");
  });

  function setupTiktokenMock() {
    jest.doMock("@dqbd/tiktoken", () => {
      throw new Error("Cannot find module '@dqbd/tiktoken'");
    });
  }

  it("loads utils and falls back when @dqbd/tiktoken is unavailable", () => {
    setupTiktokenMock();

    expect(() => {
      jest.isolateModules(() => {
        const { estimateTokens } = require("../src/utils") as typeof import("../src/utils");
        expect(estimateTokens("hello")).toBe(3);
      });
    }).not.toThrow();
  });

  it("uses default chars-per-token ratio (2.0) for non-CJK models", () => {
    setupTiktokenMock();

    jest.isolateModules(() => {
      const { estimateTokens } = require("../src/utils") as typeof import("../src/utils");
      // 100 chars / 2.0 = 50 tokens
      expect(estimateTokens("a".repeat(100), "claude-opus-4-7")).toBe(50);
      expect(estimateTokens("a".repeat(100), "gpt-5.4")).toBe(50);
      expect(estimateTokens("a".repeat(100), "gemini-3-flash")).toBe(50);
    });
  });

  it("uses CJK chars-per-token ratio (0.8) for CJK-optimized models", () => {
    setupTiktokenMock();

    jest.isolateModules(() => {
      const { estimateTokens } = require("../src/utils") as typeof import("../src/utils");
      // 100 chars / 0.8 = 125 tokens (more conservative for Chinese text)
      expect(estimateTokens("中".repeat(100), "kimi-k2.6")).toBe(125);
      expect(estimateTokens("中".repeat(100), "qwen3.6-plus")).toBe(125);
      expect(estimateTokens("中".repeat(100), "glm-5.1")).toBe(125);
      expect(estimateTokens("中".repeat(100), "hy3-preview-free")).toBe(125);
      expect(estimateTokens("中".repeat(100), "ling-2.6-flash-free")).toBe(125);
    });
  });

  it("uses default ratio when no modelId is provided", () => {
    setupTiktokenMock();

    jest.isolateModules(() => {
      const { estimateTokens } = require("../src/utils") as typeof import("../src/utils");
      expect(estimateTokens("a".repeat(10))).toBe(5);
    });
  });
});
