import fs from "fs";
import os from "os";
import path from "path";
import {
  catalogDocsDiffs,
  catalogIdsMissingFromPi,
  flattenPi,
  formatNumber,
  piApiToZen,
  piThinkingToEfforts,
  syncCatalog,
  syncDocs,
  type PiModel,
} from "../scripts/sync-from-pi-core";

const FIXTURES = path.join(__dirname, "fixtures", "sync-from-pi");

const piModel = (over: Partial<PiModel> & Pick<PiModel, "id" | "name">): PiModel => ({
  api: "openai-completions",
  provider: "opencode",
  baseUrl: "https://opencode.ai/zen/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 8192,
  ...over,
});

const piMap = (...models: PiModel[]) =>
  flattenPi({ openai: Object.fromEntries(models.map((m) => [m.id, m])) });

let dir: string;
let catalogPath: string;
let docsPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-from-pi-"));
  catalogPath = path.join(dir, "model-catalog.ts");
  docsPath = path.join(dir, "models.md");
  fs.copyFileSync(path.join(FIXTURES, "model-catalog.ts"), catalogPath);
  fs.copyFileSync(path.join(FIXTURES, "models.md"), docsPath);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = (p: string) => fs.readFileSync(p, "utf8");

/**
 * Slice one catalog entry out of the file by hand, so the assertions do not reuse the
 * same regex the writer uses (a regex bug would otherwise hide itself).
 */
const blockOf = (content: string, id: string): string => {
  const start = content.indexOf(`id: "${id}",`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = content.indexOf("\n  },", start);
  expect(end).toBeGreaterThan(start);
  return content.slice(start, end);
};

describe("sync-from-pi helpers", () => {
  it("returns an empty list for a non-reasoning model and null for a generic one", () => {
    expect(piThinkingToEfforts(piModel({ id: "a", name: "A" }))).toEqual([]);
    expect(piThinkingToEfforts(piModel({ id: "a", name: "A", reasoning: true }))).toBeNull();
  });

  it("keeps only levels Pi maps to a string, in canonical order", () => {
    const model = piModel({
      id: "a",
      name: "A",
      reasoning: true,
      thinkingLevelMap: { max: "max", low: "low", medium: null, minimal: null },
    });
    expect(piThinkingToEfforts(model)).toEqual(["low", "max"]);
  });

  it("returns an empty list when every declared level is null", () => {
    const model = piModel({ id: "a", name: "A", reasoning: true, thinkingLevelMap: { low: null } });
    expect(piThinkingToEfforts(model)).toEqual([]);
  });

  it("maps Pi api names onto Zen routeKind / apiFormat", () => {
    expect(piApiToZen("anthropic-messages")).toEqual({
      routeKind: "messages",
      apiFormat: "anthropic",
    });
    expect(piApiToZen("openai-responses")).toEqual({
      routeKind: "responses",
      apiFormat: "openai",
    });
    expect(piApiToZen("google-generative-ai")).toEqual({
      routeKind: "model_specific",
      apiFormat: "openai",
    });
    expect(piApiToZen("openai-completions")).toEqual({
      routeKind: "chat_completions",
      apiFormat: "openai",
    });
  });

  it("formats context windows the way the docs table does", () => {
    expect(formatNumber(1048576)).toBe("1,048,576");
    expect(formatNumber(65536)).toBe("65,536");
  });

  it("flattens every api group into one id-keyed map", () => {
    const a = piModel({ id: "a", name: "A" });
    const b = piModel({ id: "b", name: "B" });
    const map = flattenPi({ openai: { a }, anthropic: { b } });
    expect([...map.keys()]).toEqual(["a", "b"]);
    expect(map.get("b")).toBe(b);
  });

  it("lists the catalog ids Pi does not know, in file order", () => {
    const content = read(catalogPath);
    const map = piMap(piModel({ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }));

    expect(catalogIdsMissingFromPi(content, map)).toEqual([
      "deepseek-v4-flash-free",
      "gpt-5.6-luna",
    ]);
  });

  it("reports nothing when Pi knows every catalog id", () => {
    const content = read(catalogPath);
    const map = piMap(
      piModel({ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }),
      piModel({ id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free" }),
      piModel({ id: "gpt-5.6-luna", name: "GPT 5.6 Luna" }),
    );

    expect(catalogIdsMissingFromPi(content, map)).toEqual([]);
  });
});

describe("catalogDocsDiffs", () => {
  it("reports every cell where a docs row disagrees with its catalog entry", () => {
    const docs = read(docsPath).replace(
      "| DeepSeek V4 Flash Free | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |",
      "| DeepSeek V4 Flash Free | 131,072 | 32,000 | ✓ | ✗ | ✓ (`low,high`) | OpenAI |",
    );

    expect(catalogDocsDiffs(read(catalogPath), docs)).toEqual(
      new Map([
        [
          "deepseek-v4-flash-free",
          [
            "docs Context 131,072 vs catalog 262,144",
            "docs Max Output 32,000 vs catalog 65,536",
            "docs Vision ✓ vs catalog ✗",
            "docs Thinking ✓ (`low,high`) vs catalog ✓",
          ],
        ],
      ]),
    );
  });

  it("maps the catalog route kind onto the API column", () => {
    const docs = read(docsPath).replace(
      "### Partial Table",
      "| GPT 5.6 Luna | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh,max`) | OpenAI |\n\n### Partial Table",
    );

    expect(catalogDocsDiffs(read(catalogPath), docs)).toEqual(
      new Map([["gpt-5.6-luna", ["docs API OpenAI vs catalog Responses"]]]),
    );
  });

  it("reads entries whose block carries a leading comment", () => {
    const catalog = [
      "export const ZEN_MODEL_CATALOG = [",
      "  {",
      "    // Contributor variant: requests may be used by upstream for model training.",
      '    id: "muse-x-contributor-free",',
      '    name: "Muse X Contributor Free",',
      '    routeKind: "responses",',
      "    contextWindow: 1000,",
      "    maxOutput: 500,",
      "    supportsVision: true,",
      "    supportsThinking: true,",
      "  },",
      "];",
    ].join("\n");
    const docs = "| Muse X Contributor Free | 1,000 | 500 | ✗ | ✓ | ✓ (`low`) | Responses |\n";

    expect(catalogDocsDiffs(catalog, docs)).toEqual(
      new Map([
        [
          "muse-x-contributor-free",
          ["docs Vision ✗ vs catalog ✓", "docs Thinking ✓ (`low`) vs catalog ✓"],
        ],
      ]),
    );
  });

  it("stays quiet for matching rows, missing rows and rows with too few columns", () => {
    const catalog = read(catalogPath);

    expect(catalogDocsDiffs(catalog, read(docsPath))).toEqual(new Map());
    // gpt-5.6-luna has no row in the fixture at all.
    expect(
      catalogDocsDiffs(
        catalog,
        "| DeepSeek V4 Flash Free | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |\n",
      ),
    ).toEqual(new Map());
    expect(catalogDocsDiffs(catalog, "| DeepSeek V4 Flash Free | 262,144 |\n")).toEqual(new Map());
    expect(catalogDocsDiffs(catalog, "")).toEqual(new Map());
  });
});

describe("syncCatalog", () => {
  it("rewrites every stale field of the targeted block and leaves its neighbours alone", () => {
    const before = read(catalogPath);
    const res = syncCatalog(
      piMap(
        piModel({
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          api: "openai-responses",
          contextWindow: 2000000,
          maxTokens: 131072,
          input: ["text", "image"],
          reasoning: true,
          thinkingLevelMap: { minimal: "minimal", high: "high" },
        }),
      ),
      catalogPath,
      true,
    );

    expect(res.changed).toBe(1);
    expect(res.diffs).toEqual([
      "deepseek-v4-flash: contextWindow 1000000 -> 2000000",
      "deepseek-v4-flash: maxOutput 384000 -> 131072",
      "deepseek-v4-flash: routeKind chat_completions -> responses",
      "deepseek-v4-flash: supportsVision false -> true",
      'deepseek-v4-flash: supportedReasoningEfforts ["low", "high", "max"] -> [minimal,high]',
    ]);

    const after = read(catalogPath);
    const block = blockOf(after, "deepseek-v4-flash");
    expect(block).toContain('routeKind: "responses",');
    expect(block).toContain("contextWindow: 2000000,");
    expect(block).toContain("maxOutput: 131072,");
    expect(block).toContain("supportsVision: true,");
    expect(block).toContain('supportedReasoningEfforts: ["minimal", "high"],');
    // The prefix-adjacent "-free" entry and the untouched third entry must stay byte-identical.
    expect(blockOf(after, "deepseek-v4-flash-free")).toBe(
      blockOf(before, "deepseek-v4-flash-free"),
    );
    expect(blockOf(after, "gpt-5.6-luna")).toBe(blockOf(before, "gpt-5.6-luna"));
  });

  it("adds supportedReasoningEfforts when Pi reports levels and the block has none", () => {
    const res = syncCatalog(
      piMap(
        piModel({
          id: "deepseek-v4-flash-free",
          name: "DeepSeek V4 Flash Free",
          contextWindow: 262144,
          maxTokens: 65536,
          reasoning: true,
          thinkingLevelMap: { low: "low", high: "high" },
        }),
      ),
      catalogPath,
      true,
    );

    expect(res.diffs).toEqual([
      'deepseek-v4-flash-free: add supportedReasoningEfforts ["low", "high"]',
    ]);
    expect(blockOf(read(catalogPath), "deepseek-v4-flash-free")).toContain(
      '    supportsThinking: true,\n    supportedReasoningEfforts: ["low", "high"],',
    );
    expect(read(catalogPath)).toContain('supportedReasoningEfforts: ["low", "high"],\n  },');
  });

  it("drops supportedReasoningEfforts and thinking when Pi reports no usable level", () => {
    const res = syncCatalog(
      piMap(
        piModel({
          id: "gpt-5.6-luna",
          name: "GPT 5.6 Luna",
          api: "openai-responses",
          reasoning: true,
          thinkingLevelMap: { minimal: null, low: null },
        }),
      ),
      catalogPath,
      true,
    );

    expect(res.changed).toBe(1);
    const block = blockOf(read(catalogPath), "gpt-5.6-luna");
    expect(block).toContain("supportsThinking: false,");
    expect(block).not.toContain("supportedReasoningEfforts");
    expect(block).not.toMatch(/\n\s*\n/);
  });

  it("drops supportedReasoningEfforts when Pi says the model is not reasoning", () => {
    const models = [
      piModel({
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        contextWindow: 1000000,
        maxTokens: 384000,
      }),
    ];
    const res = syncCatalog(piMap(...models), catalogPath, true);

    expect(res.diffs).toEqual([
      "deepseek-v4-flash: supportsThinking true -> false",
      "deepseek-v4-flash: remove supportedReasoningEfforts (Pi has no levels)",
    ]);
    const block = blockOf(read(catalogPath), "deepseek-v4-flash");
    expect(block).toContain("supportsThinking: false,");
    expect(block).not.toContain("supportedReasoningEfforts");
    expect(block).not.toMatch(/\n\s*\n/);
    expect(syncCatalog(piMap(...models), catalogPath, true)).toEqual({ changed: 0, diffs: [] });
  });

  it("reports diffs without touching the file in check mode", () => {
    const before = read(catalogPath);
    const res = syncCatalog(
      piMap(
        piModel({
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          contextWindow: 2000000,
          maxTokens: 384000,
          reasoning: true,
        }),
      ),
      catalogPath,
      false,
    );

    expect(res.changed).toBe(1);
    expect(res.diffs).toEqual(["deepseek-v4-flash: contextWindow 1000000 -> 2000000"]);
    expect(read(catalogPath)).toBe(before);
  });

  it("ignores models that are absent from the catalog", () => {
    const before = read(catalogPath);
    const res = syncCatalog(
      piMap(piModel({ id: "nemotron-9", name: "Nemotron 9", contextWindow: 1 })),
      catalogPath,
      true,
    );

    expect(res).toEqual({ changed: 0, diffs: [] });
    expect(read(catalogPath)).toBe(before);
  });

  it("edits only fields a block already declares", () => {
    fs.writeFileSync(
      catalogPath,
      'export const ZEN_MODEL_CATALOG = [\n  {\n    id: "mini",\n    contextWindow: 1000,\n  },\n];\n',
    );
    const res = syncCatalog(
      piMap(piModel({ id: "mini", name: "Mini", contextWindow: 2000, input: ["text", "image"] })),
      catalogPath,
      true,
    );

    expect(res.diffs).toEqual(["mini: contextWindow 1000 -> 2000"]);
    expect(read(catalogPath)).toContain("contextWindow: 2000,");
  });

  it("reaches a block whose id line carries a leading comment", () => {
    fs.writeFileSync(
      catalogPath,
      [
        "export const ZEN_MODEL_CATALOG = [",
        "  {",
        "    // Contributor variant: requests may be used by upstream for model training.",
        '    id: "muse-x-contributor-free",',
        "    contextWindow: 1000,",
        "    supportsThinking: true,",
        "  },",
        "];",
        "",
      ].join("\n"),
    );
    const models = [
      piModel({
        id: "muse-x-contributor-free",
        name: "Muse X Contributor Free",
        contextWindow: 2000,
        reasoning: true,
        thinkingLevelMap: { minimal: "minimal", high: "high" },
      }),
    ];
    const res = syncCatalog(piMap(...models), catalogPath, true);

    expect(res.diffs).toEqual([
      "muse-x-contributor-free: contextWindow 1000 -> 2000",
      'muse-x-contributor-free: add supportedReasoningEfforts ["minimal", "high"]',
    ]);
    const after = read(catalogPath);
    expect(after).toContain("contextWindow: 2000,");
    expect(after).toContain('supportedReasoningEfforts: ["minimal", "high"],');
    // The comment that made the block unreachable must survive the rewrite.
    expect(after).toContain(
      "    // Contributor variant: requests may be used by upstream for model training.",
    );
    expect(syncCatalog(piMap(...models), catalogPath, true)).toEqual({ changed: 0, diffs: [] });
  });

  it("reports an entry whose block the regex cannot reach instead of skipping it in silence", () => {
    const catalog = [
      "export const ZEN_MODEL_CATALOG = [",
      "  {",
      "    /* zen: probed 2026-09-14 */",
      '    id: "probed-model",',
      "    contextWindow: 1000,",
      "    supportsThinking: true,",
      "  },",
      "];",
      "",
    ].join("\n");
    fs.writeFileSync(catalogPath, catalog);
    const models = [piModel({ id: "probed-model", name: "Probed Model", contextWindow: 2000 })];

    // A diff, not a warning: --check turns this into exit 1 so CI fails while the entry
    // silently keeps values nothing can verify.
    const check = syncCatalog(piMap(...models), catalogPath, false);
    expect(check).toEqual({
      changed: 0,
      diffs: ["probed-model: unreachable block (id matches the catalog, block regex does not)"],
    });

    // --write cannot reach the block either, so it must not claim to have applied anything.
    expect(syncCatalog(piMap(...models), catalogPath, true)).toEqual(check);
    expect(read(catalogPath)).toBe(catalog);
  });

  it("is idempotent: a second write finds nothing to change", () => {
    const models = [
      piModel({
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        api: "openai-responses",
        contextWindow: 2000000,
        maxTokens: 131072,
        input: ["text", "image"],
        reasoning: true,
        thinkingLevelMap: { minimal: "minimal", high: "high" },
      }),
      piModel({
        id: "deepseek-v4-flash-free",
        name: "DeepSeek V4 Flash Free",
        reasoning: true,
        thinkingLevelMap: { low: "low", high: "high" },
      }),
      piModel({
        id: "gpt-5.6-luna",
        name: "GPT 5.6 Luna",
        api: "openai-responses",
        reasoning: true,
        thinkingLevelMap: { low: null },
      }),
    ];

    expect(syncCatalog(piMap(...models), catalogPath, true).changed).toBe(3);
    expect(syncCatalog(piMap(...models), catalogPath, true)).toEqual({ changed: 0, diffs: [] });
  });
});

describe("syncDocs", () => {
  it("rewrites every stale column of the matching row and nothing else", () => {
    const before = read(docsPath);
    const res = syncDocs(
      piMap(
        piModel({
          id: "deepseek-v4-flash-free",
          name: "DeepSeek V4 Flash Free",
          contextWindow: 131072,
          maxTokens: 65536,
          input: ["text", "image"],
          reasoning: true,
          thinkingLevelMap: { low: "low", high: "high" },
        }),
      ),
      docsPath,
      true,
    );

    expect(res.changed).toBe(1);
    const oldRow = "| DeepSeek V4 Flash Free | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |";
    const newRow =
      "| DeepSeek V4 Flash Free | 131,072 | 65,536 | ✓ | ✗ | ✓ (`low,high`) | OpenAI |";
    const after = read(docsPath);
    expect(after).toContain(newRow);
    // Tools keeps its ✗ even though Vision changed to ✓, and the API column survives.
    expect(after.replace(newRow, "")).toBe(before.replace(oldRow, ""));
  });

  it("maps the API format and vision flag onto the row", () => {
    const res = syncDocs(
      piMap(
        piModel({
          id: "claude-sonnet-5",
          name: "Claude Sonnet 5",
          api: "anthropic-messages",
          contextWindow: 1000000,
          maxTokens: 64000,
          input: ["text", "image"],
          reasoning: true,
        }),
      ),
      docsPath,
      true,
    );

    expect(res.changed).toBe(1);
    expect(read(docsPath)).toContain(
      "| Claude Sonnet 5 | 1,000,000 | 64,000 | ✓ | ✗ | ✓ | Anthropic |",
    );
  });

  it("clears the Thinking column when Pi says the model is not reasoning", () => {
    const before = read(docsPath);
    const res = syncDocs(
      piMap(
        piModel({
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          contextWindow: 1000000,
          maxTokens: 384000,
        }),
      ),
      docsPath,
      true,
    );

    expect(res.diffs).toEqual(["deepseek-v4-flash: docs Thinking ✓ (`low,high,max`) -> ✗"]);
    const oldRow =
      "| DeepSeek V4 Flash | 1,000,000 | 384,000 | ✗ | ✓ | ✓ (`low,high,max`) | OpenAI |";
    const newRow = "| DeepSeek V4 Flash | 1,000,000 | 384,000 | ✗ | ✓ | ✗ | OpenAI |";
    const after = read(docsPath);
    expect(after).toContain(newRow);
    expect(after.replace(newRow, "")).toBe(before.replace(oldRow, ""));
  });

  it("leaves the Thinking column alone when Pi reports only generic reasoning", () => {
    const before = read(docsPath);
    const res = syncDocs(
      piMap(
        piModel({
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          contextWindow: 1000000,
          maxTokens: 384000,
          reasoning: true,
        }),
      ),
      docsPath,
      true,
    );

    expect(res).toEqual({ changed: 0, diffs: [] });
    expect(read(docsPath)).toBe(before);
  });

  it("skips rows with too few columns and models without a row", () => {
    const before = read(docsPath);
    const res = syncDocs(
      piMap(
        piModel({ id: "tiny-model", name: "Tiny Model", contextWindow: 2000 }),
        piModel({ id: "ghost-model", name: "Ghost Model", contextWindow: 2000 }),
      ),
      docsPath,
      true,
    );

    expect(res).toEqual({ changed: 0, diffs: [] });
    expect(read(docsPath)).toBe(before);
    expect(before).toContain("| Tiny Model | 1,000 |\n");
  });

  it("reports diffs without touching the file in check mode", () => {
    const before = read(docsPath);
    const res = syncDocs(
      piMap(
        piModel({
          id: "claude-sonnet-5",
          name: "Claude Sonnet 5",
          api: "anthropic-messages",
          contextWindow: 200000,
          maxTokens: 64000,
          reasoning: true,
        }),
      ),
      docsPath,
      false,
    );

    expect(res.changed).toBe(1);
    expect(res.diffs).toEqual(["claude-sonnet-5: docs API OpenAI -> Anthropic"]);
    expect(read(docsPath)).toBe(before);
  });

  it("is idempotent: a second write finds nothing to change", () => {
    const models = [
      piModel({
        id: "deepseek-v4-flash-free",
        name: "DeepSeek V4 Flash Free",
        contextWindow: 131072,
        input: ["text", "image"],
        reasoning: true,
        thinkingLevelMap: { low: "low", high: "high" },
      }),
      piModel({
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        api: "anthropic-messages",
        contextWindow: 1000000,
        maxTokens: 64000,
        input: ["text", "image"],
        reasoning: true,
      }),
    ];

    expect(syncDocs(piMap(...models), docsPath, true).changed).toBe(2);
    expect(syncDocs(piMap(...models), docsPath, true)).toEqual({ changed: 0, diffs: [] });
  });

  it("tolerates a missing docs file", () => {
    const res = syncDocs(
      piMap(piModel({ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" })),
      path.join(dir, "missing.md"),
      true,
    );
    expect(res).toEqual({ changed: 0, diffs: [] });
  });
});
