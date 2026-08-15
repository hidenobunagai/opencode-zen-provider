import { ZEN_MODEL_CATALOG } from "../src/model-catalog";

describe("ZEN_MODEL_CATALOG", () => {
  it("defines the OpenCode Zen model set with explicit route kinds", () => {
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
          routeKind: "messages",
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
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "claude-opus-5")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "claude-sonnet-5")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gemini-3.6-flash")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gemini-3.5-flash-lite")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gpt-5.6-luna")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gpt-5.6-sol")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gpt-5.6-terra")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "grok-4.5")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "grok-4.6")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "gemini-3.7-flash")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "muse-spark-1.2")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "hy3-free")).toBeDefined();
    expect(
      ZEN_MODEL_CATALOG.find((model) => model.id === "nemotron-3.5-lightning-free"),
    ).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "kimi-k2.7-code")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "kimi-k3")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "minimax-m3")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "laguna-s-2.1-free")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "qwen3.7-max")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "qwen3.7-plus")).toBeUndefined();
  });

  it("does not include deprecated models removed from the Zen API", () => {
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "claude-opus-4-1")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "ling-3.0-flash-free")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "north-mini-code-free")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "minimax-m2.5-free")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "hy3-preview-free")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "ling-2.6-flash-free")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "qwen3.6-plus-free")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "minimax-m3-free")).toBeUndefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "nemotron-3-super-free")).toBeUndefined();
  });

  it("has no duplicate model IDs", () => {
    const ids = ZEN_MODEL_CATALOG.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
