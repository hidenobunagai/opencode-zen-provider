/**
 * Rewrite engine behind `bun scripts/sync-from-pi.ts` (--check / --write).
 *
 * Split out of the CLI entry point so Jest can import it: sync-from-pi.ts uses
 * `import.meta.url` and top-level await, which the CommonJS tsconfig used by ts-jest
 * rejects. Paths are arguments, so tests point them at fixtures instead of the real
 * src/model-catalog.ts and docs/models.md.
 */
import fs from "fs";

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

export function flattenPi(data: PiData): Map<string, PiModel> {
  const map = new Map<string, PiModel>();
  for (const apiGroup of Object.values(data)) {
    for (const [id, model] of Object.entries(apiGroup)) {
      map.set(id, model);
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

/** The docs table row for a model, trailing newline included, or null. */
function findDocsRow(content: string, candidates: string[]): string | null {
  for (const cand of candidates) {
    const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = content.match(new RegExp(`\\|\\s*${escaped}\\s*\\|([^\\n]*\\n)`, "i"));
    if (m) return m[0];
  }
  return null;
}

/**
 * Cells where a catalog entry and its docs row disagree, keyed by entry id. `syncDocs` only
 * compares the rows of models Pi knows, and `syncCatalog` cannot rewrite a block whose shape
 * its regex does not match, so a row can keep values the catalog no longer states with nothing
 * else to notice. Zen's model list returns ids only, so the catalog values cannot be re-probed
 * either; which side is stale is a human call, hence the CLI warns and writes nothing.
 */
export function catalogDocsDiffs(
  catalogContent: string,
  docsContent: string,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const { id, block } of catalogEntries(catalogContent)) {
    const name = block.match(/name:\s*"([^"]+)",/)?.[1];
    if (!name) continue;
    const row = findDocsRow(docsContent, docsRowCandidates(id, name));
    if (!row) continue;
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
    const expEfforts = piThinkingToEfforts(piModel);

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

    const expEfforts = piThinkingToEfforts(piModel);
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
