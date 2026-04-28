import { ZEN_MODEL_CATALOG } from "../src/model-catalog";

describe("ZEN_MODEL_CATALOG", () => {
  it("defines the initial OpenCode Zen model set with explicit route kinds", () => {
    expect(ZEN_MODEL_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "gpt-5.4",
          routeKind: "responses",
        }),
        expect.objectContaining({
          id: "claude-sonnet-4-6",
          routeKind: "messages",
        }),
        expect.objectContaining({
          id: "qwen3.6-plus",
          routeKind: "chat_completions",
        }),
        expect.objectContaining({
          id: "gemini-3-flash",
          routeKind: "model_specific",
        }),
      ]),
    );
  });

  it("does not carry over Go-specific DeepSeek models into the Zen catalog", () => {
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "deepseek-v4-flash")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "deepseek-v4-pro")).toBeUndefined();
  });
});
