import { NO_TOOL_MODEL_IDS, ZEN_MODEL_CATALOG } from "../src/model-catalog";
import {
  REASONING_CONTENT_WORKAROUND_STATIC_SET,
  THINKING_MODEL_STATIC_SET,
} from "../src/constants";

describe("ZEN_MODEL_CATALOG", () => {
  it("defines the OpenCode Zen model set with explicit route kinds", () => {
    expect(ZEN_MODEL_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "deepseek-v4-flash",
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
    expect(
      ZEN_MODEL_CATALOG.find((model) => model.id === "nemotron-3.5-lightning-free"),
    ).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "kimi-k3")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "minimax-m3")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "glm-5.2")).toBeDefined();
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

  it("keeps supportedReasoningEfforts only on thinking models", () => {
    const staleEfforts = ZEN_MODEL_CATALOG.filter(
      (m) => m.supportedReasoningEfforts?.length && !m.supportsThinking,
    ).map((m) => m.id);
    expect(staleEfforts).toEqual([]);
  });

  // The sets below are keyed by id, so retiring a model used to leave its id behind in them
  // with nothing to fail: they do not read the catalog, and `bun run sync:pi` only warns
  // about catalog entries. Deleting the catalog entry alone trips this instead.
  it.each([
    ["NO_TOOL_MODEL_IDS", NO_TOOL_MODEL_IDS],
    ["REASONING_CONTENT_WORKAROUND_STATIC_SET", REASONING_CONTENT_WORKAROUND_STATIC_SET],
    ["THINKING_MODEL_STATIC_SET", THINKING_MODEL_STATIC_SET],
  ])("keeps every %s id in the catalog", (_name, set) => {
    const ids = new Set(ZEN_MODEL_CATALOG.map((m) => m.id));
    expect([...set].filter((id) => !ids.has(id))).toEqual([]);
  });
});
