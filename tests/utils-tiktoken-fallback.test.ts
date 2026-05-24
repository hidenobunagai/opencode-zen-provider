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

  it("loads utils and uses character-based estimation", () => {
    setupTiktokenMock();

    expect(() => {
      jest.isolateModules(() => {
        const { estimateTokens } = require("../src/utils") as typeof import("../src/utils");
        expect(estimateTokens("hello")).toBe(3);
      });
    }).not.toThrow();
  });

  it("uses char-based ratio (2.0 chars per token) for all models", () => {
    setupTiktokenMock();

    jest.isolateModules(() => {
      const { estimateTokens } = require("../src/utils") as typeof import("../src/utils");
      // 100 chars / 2 = 50 tokens
      expect(estimateTokens("a".repeat(100), "claude-opus-4-7")).toBe(50);
      expect(estimateTokens("a".repeat(100), "gpt-5.4")).toBe(50);
      expect(estimateTokens("a".repeat(100), "gemini-3-flash")).toBe(50);
      expect(estimateTokens("中".repeat(100), "kimi-k2.6")).toBe(50);
      expect(estimateTokens("中".repeat(100), "qwen3.6-plus")).toBe(50);
    });
  });
});
