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

  it("uses CJK-aware char-based estimation", () => {
    setupTiktokenMock();

    jest.isolateModules(() => {
      const { estimateTokens } = require("../src/utils") as typeof import("../src/utils");
      // Latin chars: 100 chars / 2 = 50 tokens
      expect(estimateTokens("a".repeat(100), "claude-opus-4-7")).toBe(50);
      expect(estimateTokens("a".repeat(100), "gpt-5.4")).toBe(50);
      expect(estimateTokens("a".repeat(100), "gemini-3-flash")).toBe(50);
      // CJK chars count as ~1 token each
      expect(estimateTokens("中".repeat(100), "kimi-k2.6")).toBe(100);
      expect(estimateTokens("中".repeat(100), "qwen3.6-plus")).toBe(100);
      expect(estimateTokens("こんにちは".repeat(20), "gpt-5.5")).toBe(100);
      // Full-width characters count as ~1 token each
      expect(estimateTokens("ＡＢＣ".repeat(30), "gpt-5.5")).toBe(90);
    });
  });
});
