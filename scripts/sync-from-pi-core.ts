/**
 * Rewrite engine behind `bun scripts/sync-from-pi.ts` (--check / --write).
 *
 * Split out of the CLI entry point so Jest can import it: sync-from-pi.ts uses
 * `import.meta.url` and top-level await, which the CommonJS tsconfig used by ts-jest
 * rejects. Paths are arguments, so tests point them at fixtures instead of the real
 * src/model-catalog.ts and docs/models.md.
 */
import fs from "fs";
import { resolveEfforts, type EffortDecisionSet } from "./effort-decisions";

export type PiModel = {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Record<string, string | null>;
  compat?: Record<string, unknown>;
};

export type PiData = Record<string, Record<string, PiModel>>;

/**
 * One entry of models.dev's `opencode` provider, reduced to what a catalog block needs.
 * Zen's own `/models` endpoint returns ids only, so for a model Pi does not carry this is
 * the only place its context window, output limit, vision flag, and effort ladder come from.
 */
export type ModelsDevModel = {
  id: string;
  name?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  reasoning_options?: { type?: string; values?: string[] }[];
  limit?: { context?: number; output?: number };
  provider?: { npm?: string };
};

/** What a catalog entry states, once parsed out of its block. */
export type CatalogEntry = {
  id: string;
  block: string;
  name: string | null;
  routeKind: string | null;
  apiFormat: string | null;
  contextWindow: number | null;
  maxOutput: number | null;
  supportsTools: boolean | null;
  supportsVision: boolean | null;
  supportsThinking: boolean | null;
  efforts: string[];
};

export function flattenPi(data: PiData): Map<string, PiModel> {
  const map = new Map<string, PiModel>();
  for (const apiGroup of Object.values(data)) {
    for (const [key, model] of Object.entries(apiGroup)) {
      // pi-ai's keys carry a kind prefix (`chat:gpt-5.2`, `classifier:jev-1.13`) while the
      // catalog writes the bare id. Keyed on the raw key every lookup missed, so the whole
      // comparison was a silent no-op (measured 2026-10-04: 0 of 22 catalog ids matched).
      map.set(model.id || key.replace(/^[a-z-]+:/, ""), model);
    }
  }
  return map;
}

/**
 * Every catalog entry, from its `id:` line to the block's closing `},`, in file order. The
 * anchor is the same one `catalogIdsMissingFromPi` and the tests use, so the reader sees
 * every entry — including one whose leading `//` comment `syncCatalog`'s block regex cannot
 * reach.
 */
function catalogEntries(content: string): { id: string; block: string }[] {
  return [...content.matchAll(/^ {4}id: "([^"]+)",/gm)].map((match) => {
    const start = match.index ?? 0;
    const end = content.indexOf("\n  },", start);
    return { id: match[1], block: content.slice(start, end === -1 ? undefined : end) };
  });
}

/**
 * Catalog ids that Pi's map does not contain. `syncCatalog` never sees these (its id regex
 * matches nothing, so the loop `continue`s) and neither does `syncDocs`, which means no
 * field in such an entry is ever verified: a model Zen has dropped stays in the catalog and
 * in the model picker unnoticed. The CLI reports these ids against the live Zen model list.
 */
export function catalogIdsMissingFromPi(content: string, piMap: Map<string, PiModel>): string[] {
  return catalogEntries(content)
    .map((entry) => entry.id)
    .filter((id) => !piMap.has(id));
}

/**
 * Levels Pi declares for a model. `[]` means Pi says there are none (non-reasoning, or a map
 * with no usable level) and callers must clear stale details. `null` means Pi is generic
 * (reasoning with no level map) and callers must leave existing details alone.
 */
export function piThinkingToEfforts(m: PiModel): string[] | null {
  if (!m.reasoning) return [];
  const map = m.thinkingLevelMap;
  if (!map) return null;
  const efforts: string[] = [];
  for (const k of ["minimal", "low", "medium", "high", "xhigh", "max"] as const) {
    const v = (map as Record<string, string | null>)[k];
    if (typeof v === "string") efforts.push(k);
  }
  const hasAnyString = efforts.length > 0;
  const hasMapKeys = Object.keys(map).length > 0;
  if (!hasAnyString && hasMapKeys) return [];
  return efforts;
}

/**
 * Catalog ids whose ladder rests on nothing: Pi carries the generic "reasoning: true" default
 * and no decision is recorded. `syncCatalog`/`syncDocs` leave such entries alone, so this is the
 * only place they surface. The CLI prints it as a warning (never as drift): a model added in a
 * hurry keeps its current picker, but the gap stays visible until someone records a decision.
 */
export function unverifiedEfforts(
  catalogContent: string,
  piMap: Map<string, PiModel>,
  decisions: EffortDecisionSet,
): string[] {
  const inCatalog = new Set(catalogEntries(catalogContent).map((entry) => entry.id));
  const out: string[] = [];
  for (const [id, model] of piMap.entries()) {
    if (!inCatalog.has(id)) continue;
    const resolved = resolveEfforts(id, model.reasoning, piThinkingToEfforts(model), decisions);
    if (resolved.evidence === "generic") out.push(id);
  }
  return out;
}

export function piApiToZen(api: string): { routeKind: string; apiFormat: string } {
  if (api === "anthropic-messages") return { routeKind: "messages", apiFormat: "anthropic" };
  if (api === "openai-responses") return { routeKind: "responses", apiFormat: "openai" };
  if (api === "google-generative-ai") return { routeKind: "model_specific", apiFormat: "openai" };
  return { routeKind: "chat_completions", apiFormat: "openai" };
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** API column label of docs/models.md for a route kind. */
function apiDisplay(routeKind: string): string {
  if (routeKind === "responses") return "Responses";
  if (routeKind === "messages") return "Anthropic";
  return "OpenAI";
}

/** The two spellings of a model the docs tables are looked up with. */
function docsRowCandidates(id: string, name: string): string[] {
  return [
    id
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    name,
  ];
}

/**
 * Route kind for a model only models.dev describes. Its `provider.npm` names the client the
 * Zen console uses, and across the models both sources describe it maps one-to-one onto the
 * transport Pi records (measured 2026-10-21 against models.dev api.json, provider `opencode`):
 * `@ai-sdk/openai` → 30/30 `openai-responses`, absent → 27/27 `openai-completions`,
 * `@ai-sdk/anthropic` → 18/18 `anthropic-messages`, `@ai-sdk/google` → 8/8 model-specific,
 * `@ai-sdk/mistral` → 1/1 `openai-completions`. The distinction matters: `/chat/completions`
 * and `/responses` take different request bodies, so a wrong guess breaks the model outright.
 */
function modelsDevRouteKind(m: ModelsDevModel): { routeKind: string; apiFormat: string } {
  const npm = m.provider?.npm;
  if (npm === "@ai-sdk/anthropic") return { routeKind: "messages", apiFormat: "anthropic" };
  if (npm === "@ai-sdk/google") return { routeKind: "model_specific", apiFormat: "openai" };
  if (npm === "@ai-sdk/openai") return { routeKind: "responses", apiFormat: "openai" };
  return { routeKind: "chat_completions", apiFormat: "openai" };
}

/** A catalog entry rendered from models.dev data, for a model Pi does not describe. */
export function entryFromModelsDev(m: ModelsDevModel): CatalogEntry {
  const route = modelsDevRouteKind(m);
  const efforts: string[] = [];
  for (const opt of m.reasoning_options ?? []) {
    if (opt?.type === "effort") {
      for (const v of opt.values ?? []) efforts.push(v);
    }
  }
  const contextWindow = m.limit?.context ?? null;
  const maxOutput = m.limit?.output ?? null;
  return {
    id: m.id,
    block: "",
    name: m.name ?? m.id,
    routeKind: route.routeKind,
    apiFormat: route.apiFormat,
    contextWindow,
    maxOutput,
    supportsTools: m.tool_call ?? null,
    supportsVision: m.attachment ?? null,
    supportsThinking: m.reasoning ?? null,
    efforts,
  };
}

/** A catalog entry rendered from Pi data, for a model models.dev does not describe. */
export function entryFromPi(m: PiModel): CatalogEntry {
  const route = piApiToZen(m.api);
  const efforts = piThinkingToEfforts(m);
  return {
    id: m.id,
    block: "",
    name: m.name,
    routeKind: route.routeKind,
    apiFormat: route.apiFormat,
    contextWindow: m.contextWindow ?? null,
    maxOutput: m.maxTokens ?? null,
    supportsTools: true,
    supportsVision: m.input.includes("image"),
    supportsThinking: m.reasoning,
    efforts: efforts ?? [],
  };
}

/** One `ZEN_MODEL_CATALOG` entry, formatted the way the catalog file writes them. */
export function renderCatalogBlock(entry: CatalogEntry): string {
  const name = entry.name ?? entry.id;
  const lines = [
    "  {",
    `    id: "${entry.id}",`,
    `    requestModelId: "${entry.id}",`,
    `    name: ${JSON.stringify(name)},`,
    `    displayName: ${JSON.stringify(name)},`,
    `    routeKind: "${entry.routeKind ?? "chat_completions"}",`,
    `    apiFormat: "${entry.apiFormat ?? "openai"}",`,
    `    contextWindow: ${entry.contextWindow ?? 0},`,
    `    maxOutput: ${entry.maxOutput ?? 0},`,
    `    supportsTools: ${entry.supportsTools ?? true},`,
    `    supportsVision: ${entry.supportsVision ?? false},`,
  ];
  const thinking = entry.supportsThinking ?? entry.efforts.length > 0;
  lines.push(`    supportsThinking: ${thinking},`);
  if (thinking && entry.efforts.length > 0) {
    lines.push(
      `    supportedReasoningEfforts: [${entry.efforts.map((e) => `"${e}"`).join(", ")}],`,
    );
  }
  lines.push("  },");
  return lines.join("\n");
}

/** Appends rendered blocks to the end of `ZEN_MODEL_CATALOG`, before its closing `];`. */
export function appendCatalogBlocks(content: string, blocks: string[]): string {
  if (blocks.length === 0) return content;
  const close = content.lastIndexOf("\n];");
  if (close < 0) throw new Error("ZEN_MODEL_CATALOG closing bracket not found");
  return `${content.slice(0, close)}\n${blocks.join("\n")}${content.slice(close)}`;
}

/** Ids, in file order, that the given `ZEN_MODEL_CATALOG` text still lists. */
export function catalogIds(content: string): string[] {
  return catalogEntries(content).map((entry) => entry.id);
}

/**
 * Removes one catalog entry — its opening `{`, body, and closing `},` — from the file text.
 *
 * `catalogEntries` anchors a block on its `id:` line, which leaves the `{` and any comment
 * above it behind; deleting just that slice produced empty `{ }` entries. So the block bounds
 * are recomputed here, one line at a time: back to the entry's own `  {` (plus comment lines
 * directly above it), forward to its `  },`.
 */
export function removeCatalogEntry(content: string, id: string): string {
  const lines = content.split("\n");
  const idLine = new RegExp(`^ {4}id: "${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",$`);
  const at = lines.findIndex((l) => idLine.test(l));
  if (at < 0) return content;

  let start = at;
  while (start > 0 && lines[start] !== "  {") start--;
  if (lines[start] !== "  {") return content;
  // A comment block written above the entry documents that entry, so it goes with it.
  while (start > 0 && lines[start - 1].trimStart().startsWith("//")) start--;

  let end = at;
  while (end < lines.length && lines[end] !== "  },") end++;
  if (end >= lines.length) return content;

  lines.splice(start, end - start + 1);
  return lines.join("\n");
}

/** Parses one catalog block into the fields the mirror and the docs table need. */
function parseCatalogEntry(id: string, block: string): CatalogEntry {
  const num = (re: RegExp): number | null => {
    const m = block.match(re);
    return m ? Number(m[1]) : null;
  };
  const bool = (re: RegExp): boolean | null => {
    const m = block.match(re);
    return m ? m[1] === "true" : null;
  };
  const efforts = [
    ...(block.match(/supportedReasoningEfforts:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g),
  ].map((m) => m[1]);
  return {
    id,
    block,
    name: block.match(/name:\s*"([^"]+)",/)?.[1] ?? null,
    routeKind: block.match(/routeKind:\s*"([^"]+)",/)?.[1] ?? null,
    apiFormat: block.match(/apiFormat:\s*"([^"]+)",/)?.[1] ?? null,
    contextWindow: num(/contextWindow:\s*(\d+),/),
    maxOutput: num(/maxOutput:\s*(\d+),/),
    supportsTools: bool(/supportsTools:\s*(true|false),/),
    supportsVision: bool(/supportsVision:\s*(true|false),/),
    supportsThinking: bool(/supportsThinking:\s*(true|false),/),
    efforts,
  };
}

/** Every catalog entry, parsed. */
export function parseCatalog(content: string): CatalogEntry[] {
  return catalogEntries(content).map(({ id, block }) => parseCatalogEntry(id, block));
}

/**
 * Pi transports this extension has no client for. `jev-1.13` is a System One classifier served
 * on its own route; `piApiToZen` would fold it into `chat_completions`, and the model would be
 * listed in the picker and then fail on every request. Such ids are reported as unaddable
 * instead of being mirrored, and in CHECK mode they do not count as drift — no amount of
 * `--write` can make an unusable transport work.
 */
export const UNSUPPORTED_PI_APIS = new Set(["typesafe-system-one"]);

/**
 * Ids Zen serves that are not models a user can pick, so neither the mirror nor the docs table
 * should list them. `test` is a reachability probe sitting in Zen's own list, and `-backup`
 * marks a failover copy of a model already listed under its own id. Kept explicit rather than
 * pattern-matched, so a real model cannot be excluded by accident.
 */
export const NON_MODEL_ZEN_IDS = new Set(["test", "claude-opus-5-5-backup"]);

/** Served ids that belong in the catalog: not a probe, not a failover copy. */
export function servableIds(served: Iterable<string>): string[] {
  return [...served].filter((id) => !NON_MODEL_ZEN_IDS.has(id));
}

/**
 * Splits mirror drift into what the gate can fix and what it cannot. A served id that Pi puts
 * on a transport this extension has no client for (`UNSUPPORTED_PI_APIS`) can never be added
 * automatically, so it is surfaced separately and kept out of the must-fix set — otherwise
 * every daily run would wake an agent over a dead end.
 */
export function splitUnaddable(
  missing: string[],
  piMap: Map<string, PiModel>,
): { addable: string[]; unaddable: string[] } {
  const addable: string[] = [];
  const unaddable: string[] = [];
  for (const id of missing) {
    const api = piMap.get(id)?.api;
    if (api && UNSUPPORTED_PI_APIS.has(api)) unaddable.push(id);
    else addable.push(id);
  }
  return { addable, unaddable };
}

/**
 * Models the Zen API serves but the catalog does not list, and the reverse. Both are drift:
 * the first means Zen released something the extension cannot offer, the second means the
 * extension still offers an id Zen answers with "Model is disabled". Neither can be noticed
 * by comparing field values — the id sets have to be compared directly.
 */
export function mirrorDrift(
  served: Iterable<string>,
  listed: Iterable<string>,
): { missing: string[]; retired: string[] } {
  const servedSet = new Set(served);
  const listedSet = new Set(listed);
  return {
    missing: [...servedSet].filter((id) => !listedSet.has(id)).sort(),
    retired: [...listedSet].filter((id) => !servedSet.has(id)).sort(),
  };
}

/** Heading that starts the generated model table, and the heading that ends it. */
const MODEL_LIST_HEADING = "## Model List";
const AFTER_MODEL_LIST_HEADING = "## Removed from the API";

/**
 * The Thinking cell, in exactly the shape `catalogDocsDiffs` compares against, so a generated
 * table is always in agreement with the catalog it came from.
 */
function thinkingCell(entry: CatalogEntry): string {
  if (entry.supportsThinking !== true) return "✗";
  if (entry.efforts.length === 0) return "✓";
  return `✓ (\`${entry.efforts.join(",")}\`)`;
}

/**
 * Per-family behaviour the table cannot express. Kept in the generator rather than typed below
 * the table in docs/models.md, because `sync:pi:write` rewrites this whole section — a note
 * written by hand there is gone on the next run.
 */
const FAMILY_NOTES = [
  "- **DeepSeek V4+** require `REASONING_CONTENT_WORKAROUND_MODELS` for correct streaming output.",
  '  System prompts are sanitized to replace "Claude"/"Anthropic" references.',
  '- **Gemini** use the model-specific route (`/models/{id}`) — the API column reads "OpenAI"',
  "  because that is the request format, not the endpoint.",
  "- **GPT** and **Grok** use the **Responses API** route (`/responses`) and internally reason, so",
  "  they count as thinking models (`THINKING_MODELS`) for output budget purposes.",
  "- **Kimi** use `fixedTemperature: 1` and require `REASONING_CONTENT_WORKAROUND_MODELS` (all but",
  "  K2.5) for correct streaming output.",
  "- **Muse Spark 1.2** uses the Responses route and counts as a thinking model.",
  "- **Tool-less models** (`NO_TOOL_MODEL_IDS`: Big Pickle, Nemotron 3.5 Lightning Free) declare",
  "  `toolCalling` so they appear in the picker, but the provider strips tools before sending.",
  "  Other `-free` models do support tools and vision.",
];

/** The whole `## Model List` section, one row per catalog entry, sorted by id. */
export function renderModelListSection(entries: CatalogEntry[]): string {
  const rows = [...entries]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => {
      const cells = [
        entry.name ?? entry.id,
        entry.contextWindow === null ? "—" : formatNumber(entry.contextWindow),
        entry.maxOutput === null ? "—" : formatNumber(entry.maxOutput),
        entry.supportsVision ? "✓" : "✗",
        entry.supportsTools === false ? "✗" : "✓",
        thinkingCell(entry),
        // `catalogDocsDiffs` reads this column through `apiDisplay`, which folds the
        // model-specific route into "OpenAI"; mirror it so a generated table never disagrees
        // with its own catalog. The `/models/{id}` detail stays in the family notes.
        entry.routeKind === null ? "OpenAI" : apiDisplay(entry.routeKind),
      ];
      return `| ${cells.join(" | ")} |`;
    });
  return [
    MODEL_LIST_HEADING,
    "",
    "One row per entry in `ZEN_MODEL_CATALOG`, sorted by model id. This table is generated:",
    "`bun run sync:pi:write` rewrites it from the catalog, so edit `src/model-catalog.ts`",
    "rather than the table.",
    "",
    "| Model | Context | Max Output | Vision | Tools | Thinking | API |",
    "|-------|---------|------------|--------|-------|----------|-----|",
    ...rows,
    "",
    "Family notes (the table above cannot carry them, so they live here):",
    "",
    ...FAMILY_NOTES,
  ].join("\n");
}

/**
 * Replaces the `## Model List` section of docs/models.md with `section`, leaving every other
 * section (notes, quirks, capability matrix) untouched.
 */
export function replaceModelListSection(docs: string, section: string): string {
  const start = docs.indexOf(MODEL_LIST_HEADING);
  if (start < 0) throw new Error(`${MODEL_LIST_HEADING} not found in docs/models.md`);
  const end = docs.indexOf(AFTER_MODEL_LIST_HEADING, start);
  if (end < 0) throw new Error(`${AFTER_MODEL_LIST_HEADING} not found in docs/models.md`);
  return `${docs.slice(0, start)}${section}\n\n${docs.slice(end)}`;
}

/** The docs table row for a model, trailing newline included, or null. */
function findDocsRow(content: string, candidates: string[]): string | null {
  for (const cand of candidates) {
    // A dash and a space are the same separator in a model name: the docs write `GLM-5.2`
    // where the catalog says `GLM 5.2`, and neither spelling is the one to force on the
    // other. Treated as one, either finds the row.
    const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s]+/g, "[-\\s]+");
    const m = content.match(new RegExp(`\\|\\s*${escaped}\\s*\\|([^\\n]*\\n)`, "i"));
    if (m) return m[0];
  }
  return null;
}

/**
 * Cells where a catalog entry and its docs row disagree, keyed by entry id. `syncDocs` only
 * compares the rows of models Pi knows, and `syncCatalog` cannot rewrite a block whose shape
 * its regex does not match, so a row can keep values the catalog no longer states with nothing
 * else to notice. An entry *no* row matches is reported too: it is the one state where even
 * `syncDocs` has nothing to compare against, so the entry would go unverified in silence.
 * Zen's model list returns ids only, so the catalog values cannot be re-probed either; which
 * side is stale is a human call, hence the CLI warns and writes nothing.
 */
export function catalogDocsDiffs(
  catalogContent: string,
  docsContent: string,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const { id, block } of catalogEntries(catalogContent)) {
    const name = block.match(/name:\s*"([^"]+)",/)?.[1];
    if (!name) continue;
    const candidates = docsRowCandidates(id, name);
    const row = findDocsRow(docsContent, candidates);
    if (!row) {
      result.set(id, [`no docs row matches ${candidates.join(" / ")}`]);
      continue;
    }
    const cells = row.split("|").map((c) => c.trim());
    if (cells.length < 8) continue;

    const ctx = block.match(/contextWindow:\s*(\d+),/);
    const max = block.match(/maxOutput:\s*(\d+),/);
    const vision = block.match(/supportsVision:\s*(true|false),/);
    const route = block.match(/routeKind:\s*"([^"]+)",/);
    const efforts = [
      ...(block.match(/supportedReasoningEfforts:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(
        /"([^"]+)"/g,
      ),
    ].map((m) => m[1]);
    const thinking = !/supportsThinking:\s*true,/.test(block)
      ? "✗"
      : efforts.length > 0
        ? `✓ (\`${efforts.join(",")}\`)`
        : "✓";

    const diffs: string[] = [];
    const compare = (column: string, current: string, expected: string | null) => {
      if (expected !== null && current !== expected)
        diffs.push(`docs ${column} ${current} vs catalog ${expected}`);
    };
    compare("Context", cells[2], ctx ? formatNumber(Number(ctx[1])) : null);
    compare("Max Output", cells[3], max ? formatNumber(Number(max[1])) : null);
    compare("Vision", cells[4], vision ? (vision[1] === "true" ? "✓" : "✗") : null);
    compare("Thinking", cells[6], thinking);
    compare("API", cells[7], route ? apiDisplay(route[1]) : null);
    if (diffs.length > 0) result.set(id, diffs);
  }
  return result;
}

// --- src/model-catalog.ts sync ---
export function syncCatalog(
  piMap: Map<string, PiModel>,
  catalogPath: string,
  write: boolean,
  decisions: EffortDecisionSet = {},
): { changed: number; diffs: string[] } {
  let content = fs.readFileSync(catalogPath, "utf8");
  const diffs: string[] = [];
  let changed = 0;

  for (const [piId, piModel] of piMap.entries()) {
    const escapedId = piId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRegex = new RegExp(`id:\\s*"${escapedId}"`);
    if (!idRegex.test(content)) continue;

    // `{` may be followed by `//` comment lines before `id:` (muse-spark-1.2-contributor-free
    // carries one). Without `(?://[^\n]*\n\s*)*` the block is not found,
    // while the id regex above still matches. Any other leading shape (a `/* */` comment, for
    // one) is still unreachable, so report it as a diff: --check exits 1 and CI stops instead
    // of letting the entry go unverified the way 48688c3 did for weeks.
    const blockRegex = new RegExp(
      `\\{\\s*(?://[^\\n]*\\n\\s*)*id:\\s*"${escapedId}"[\\s\\S]*?\\},`,
      "m",
    );
    const match = content.match(blockRegex);
    if (!match) {
      diffs.push(`${piId}: unreachable block (id matches the catalog, block regex does not)`);
      continue;
    }
    let block = match[0];
    const originalBlock = block;

    const expCtx = piModel.contextWindow;
    const expMax = piModel.maxTokens;
    const expVision = piModel.input.includes("image");
    const { routeKind: expRoute, apiFormat: expApi } = piApiToZen(piModel.api);
    const expEfforts = resolveEfforts(
      piId,
      piModel.reasoning,
      piThinkingToEfforts(piModel),
      decisions,
    ).efforts;

    const ctxMatch = block.match(/contextWindow:\s*(\d+),/);
    if (ctxMatch && Number(ctxMatch[1]) !== expCtx) {
      diffs.push(`${piId}: contextWindow ${ctxMatch[1]} -> ${expCtx}`);
      block = block.replace(/contextWindow:\s*\d+,/, `contextWindow: ${expCtx},`);
    }
    const maxMatch = block.match(/maxOutput:\s*(\d+),/);
    if (maxMatch && Number(maxMatch[1]) !== expMax) {
      diffs.push(`${piId}: maxOutput ${maxMatch[1]} -> ${expMax}`);
      block = block.replace(/maxOutput:\s*\d+,/, `maxOutput: ${expMax},`);
    }

    const routeMatch = block.match(/routeKind:\s*"([^"]+)",/);
    if (routeMatch && routeMatch[1] !== expRoute) {
      diffs.push(`${piId}: routeKind ${routeMatch[1]} -> ${expRoute}`);
      block = block.replace(/routeKind:\s*"[^"]+",/, `routeKind: "${expRoute}",`);
    }
    const apiMatch = block.match(/apiFormat:\s*"([^"]+)",/);
    if (apiMatch && apiMatch[1] !== expApi) {
      diffs.push(`${piId}: apiFormat ${apiMatch[1]} -> ${expApi}`);
      block = block.replace(/apiFormat:\s*"[^"]+",/, `apiFormat: "${expApi}",`);
    }

    const visionMatch = block.match(/supportsVision:\s*(true|false),/);
    if (visionMatch) {
      const cur = visionMatch[1] === "true";
      if (cur !== expVision) {
        diffs.push(`${piId}: supportsVision ${cur} -> ${expVision}`);
        block = block.replace(/supportsVision:\s*(true|false),/, `supportsVision: ${expVision},`);
      }
    }

    const thinkingMatch = block.match(/supportsThinking:\s*(true|false),?/);
    const curThinking = thinkingMatch ? thinkingMatch[1] === "true" : false;
    // null = Pi is generic (reasoning, no level map): keep the current flag. Otherwise Pi is
    // explicit, so a model with no levels (including a non-reasoning one) turns thinking off.
    if (expEfforts !== null) {
      const targetThinking = expEfforts.length > 0;
      if (curThinking !== targetThinking) {
        diffs.push(`${piId}: supportsThinking ${curThinking} -> ${targetThinking}`);
        if (thinkingMatch) {
          block = block.replace(
            /supportsThinking:\s*(true|false),?/,
            `supportsThinking: ${targetThinking},`,
          );
        }
      }
    }

    // supportedReasoningEfforts
    if (expEfforts !== null) {
      const shouldHaveEfforts = expEfforts.length > 0;
      const hasEfforts = /supportedReasoningEfforts:\s*\[/.test(block);
      if (!shouldHaveEfforts) {
        if (hasEfforts) {
          diffs.push(`${piId}: remove supportedReasoningEfforts (Pi has no levels)`);
          block = block.replace(/\s*supportedReasoningEfforts:\s*\[[^\]]*\],?\n/, "\n");
        }
      } else {
        const expStr = `[${expEfforts.map((e) => `"${e}"`).join(", ")}]`;
        if (hasEfforts) {
          const curMatch = block.match(/supportedReasoningEfforts:\s*\[([^\]]*)\]/);
          const cur = curMatch ? curMatch[1] : "";
          const curNorm = cur.replace(/\s/g, "").replace(/"/g, "");
          const expNorm = expEfforts.join(",");
          if (curNorm !== expNorm) {
            diffs.push(`${piId}: supportedReasoningEfforts [${cur}] -> [${expEfforts.join(",")}]`);
            block = block.replace(
              /supportedReasoningEfforts:\s*\[[^\]]*\],?/,
              `supportedReasoningEfforts: ${expStr},`,
            );
          }
        } else {
          diffs.push(`${piId}: add supportedReasoningEfforts ${expStr}`);
          if (block.includes("supportsThinking:")) {
            block = block.replace(
              /(supportsThinking:\s*(true|false),?)/,
              `$1\n    supportedReasoningEfforts: ${expStr},`,
            );
          } else {
            block = block.replace(
              /(apiFormat:\s*"[^"]+",)/,
              `$1\n    supportedReasoningEfforts: ${expStr},`,
            );
          }
        }
      }
    }

    if (block !== originalBlock) {
      content = content.replace(match[0], block);
      changed++;
    }
  }

  if (write && changed > 0) {
    fs.writeFileSync(catalogPath, content, "utf8");
  }
  return { changed, diffs };
}

// --- docs/models.md sync ---
export function syncDocs(
  piMap: Map<string, PiModel>,
  docsPath: string,
  write: boolean,
  decisions: EffortDecisionSet = {},
): { changed: number; diffs: string[] } {
  if (!fs.existsSync(docsPath)) return { changed: 0, diffs: [] };
  let content = fs.readFileSync(docsPath, "utf8");
  const diffs: string[] = [];
  let changed = 0;

  for (const [piId, piModel] of piMap.entries()) {
    const fullRow = findDocsRow(content, docsRowCandidates(piId, piModel.name));
    if (!fullRow) continue;
    const cells = fullRow.split("|").map((c) => c.trim());
    if (cells.length < 8) continue;

    const expCtxStr = formatNumber(piModel.contextWindow);
    const expMaxStr = formatNumber(piModel.maxTokens);
    const expVision = piModel.input.includes("image") ? "✓" : "✗";
    // Use piApiToZen routeKind to decide: responses => Responses, anthropic => Anthropic, else OpenAI
    const { routeKind } = piApiToZen(piModel.api);
    const expApiDisplay = apiDisplay(routeKind);

    const expEfforts = resolveEfforts(
      piId,
      piModel.reasoning,
      piThinkingToEfforts(piModel),
      decisions,
    ).efforts;
    let expThinking: string;
    if (!piModel.reasoning) expThinking = "✗";
    else if (expEfforts === null) expThinking = "✓";
    else if (expEfforts.length === 0) expThinking = "✗";
    else expThinking = `✓ (\`${expEfforts.join(",")}\`)`;

    const curCtx = cells[2];
    const curMax = cells[3];
    const curVision = cells[4];
    const curThinking = cells[6];
    const curApi = cells[7];

    // Build expected row via cell reconstruction to avoid replacing duplicate "✓" values
    const newCells = [...cells];
    let rowChanged = false;
    if (curCtx !== expCtxStr) {
      diffs.push(`${piId}: docs Context ${curCtx} -> ${expCtxStr}`);
      newCells[2] = expCtxStr;
      rowChanged = true;
    }
    if (curMax !== expMaxStr) {
      diffs.push(`${piId}: docs Max ${curMax} -> ${expMaxStr}`);
      newCells[3] = expMaxStr;
      rowChanged = true;
    }
    if (curVision !== expVision) {
      diffs.push(`${piId}: docs Vision ${curVision} -> ${expVision}`);
      newCells[4] = expVision;
      rowChanged = true;
    }
    if (curApi !== expApiDisplay) {
      diffs.push(`${piId}: docs API ${curApi} -> ${expApiDisplay}`);
      newCells[7] = expApiDisplay;
      rowChanged = true;
    }
    if (expEfforts !== null && curThinking !== expThinking) {
      diffs.push(`${piId}: docs Thinking ${curThinking} -> ${expThinking}`);
      newCells[6] = expThinking;
      rowChanged = true;
    }
    // Tools column (newCells[5]) stays as-is

    if (rowChanged) {
      const newRow = `| ${newCells.slice(1, 8).join(" | ")} |\n`;
      content = content.replace(fullRow, newRow);
      changed++;
    }
  }

  if (write && changed > 0) {
    fs.writeFileSync(docsPath, content, "utf8");
  }
  return { changed, diffs };
}
