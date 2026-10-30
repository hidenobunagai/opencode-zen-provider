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
          id: "deepseek-v4-pro",
          routeKind: "chat_completions",
        }),
        expect.objectContaining({
          id: "muse-spark-1.2",
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
          id: "gemini-3.5-flash",
          routeKind: "model_specific",
        }),
      ]),
    );
  });

  it("includes newly added models from the Zen API", () => {
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "deepseek-v4-pro")).toBeDefined();
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "deepseek-v4.1-flash")).toBeDefined();
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

  // The catalog mirrors whatever `GET /zen/v1/models` serves, so an entry comes back when Zen
  // re-enables it: the Claude, GPT and Gemini families below were recorded as "disabled" in
  // docs/models.md on 2026-08-22 and are served again as of 2026-10-21. Asserting absence per
  // id here is what let the catalog drift 60-odd models behind — this test and the docs agreed
  // with each other while both disagreed with the API.
  it("does not include ids the Zen API does not serve", () => {
    for (const id of ["claude-opus-4-1", "ling-3.0-flash-free", "north-mini-code-free"]) {
      expect(ZEN_MODEL_CATALOG.find((model) => model.id === id)).toBeUndefined();
    }
    // A failover copy and a reachability probe are not pickable models.
    expect(ZEN_MODEL_CATALOG.find((model) => model.id === "test")).toBeUndefined();
    expect(
      ZEN_MODEL_CATALOG.find((model) => model.id === "claude-opus-5-5-backup"),
    ).toBeUndefined();
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
