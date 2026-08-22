import { ZEN_MODEL_CATALOG } from "../src/model-catalog";

describe("ZEN_MODEL_CATALOG", () => {
  it("defines the OpenCode Zen model set with explicit route kinds", () => {
    expect(ZEN_MODEL_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "deepseek-v4-flash",
          routeKind: "chat_completions",
        }),
        expect.objectContaining({
          id: "x-preview-f-free",
          routeKind: "chat_completions",
        }),
        expect.objectContaining({
          id: "muse-spark-1.2-contributor-free",
          routeKind: "responses",
        }),
        expect.objectContaining({
          id: "grok-4.5",
          routeKind: "responses",
        }),
        expect.objectContaining({
          id: "grok-build-0.1",
          routeKind: "responses",
        }),
        expect.objectContaining({
          id: "gemini-3-flash",
          routeKind: "model_specific",
        }),
      ]),
    );
  });

  it("includes newly added models from the Zen API", () => {
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "deepseek-v4-flash")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "deepseek-v4-pro")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gemini-3.6-flash")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gemini-3.5-flash-lite")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gpt-5.6-luna")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gpt-5.6-sol")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gpt-5.6-terra")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "grok-4.5")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "grok-4.6")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gemini-3.7-flash")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "muse-spark-1.2")).toBeDefined();
    expect(
      ZEN_MODEL_CATALOG.find((model) => model.id === "muse-spark-1.2-contributor-free"),
    ).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "x-preview-f-free")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "hy3-free")).toBeDefined();
    expect(
      ZEN_MODEL_CATALOG.find((model) => model.id === "nemotron-3.5-lightning-free"),
    ).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "kimi-k3")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "minimax-m3")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "glm-5.2")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "laguna-s-2.1-free")).toBeDefined();
  });

  it("does not include models served only by other Zen routes", () => {
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "qwen3.7-max")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "qwen3.7-plus")).toBeUndefined();
  });

  it("does not include disabled models removed from the Zen API", () => {
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "claude-opus-5")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "claude-sonnet-5")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "claude-opus-4-1")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "ling-3.0-flash-free")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "north-mini-code-free")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gpt-5.5-pro")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gpt-5.4")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "glm-5.1")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "kimi-k2.7-code")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "minimax-m2.7")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "qwen3.6-plus")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gemini-3.1-pro")).toBeUndefined();
  });

  it("has no duplicate model IDs", () => {
    const ids = ZEN_MODEL_CATALOG.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
