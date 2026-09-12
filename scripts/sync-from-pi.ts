#!/usr/bin/env bun
/**
 * Sync from Pi's opencode.json to opencode-zen-provider.
 * - Compares Pi's provider data (contextWindow/maxTokens/vision/api/thinkingLevelMap)
 *   with ZEN_MODEL_CATALOG in src/model-catalog.ts and docs/models.md tables.
 * - Default: --check (report diff). With --write, updates src/model-catalog.ts and docs/models.md.
 *
 * Pi source resolution:
 *  1) Local pi-ai install (global bun, deepseek-harness pnpm, cache)
 *  2) Fallback fetch from unpkg/jsdelivr
 *
 * Note: Pi provider "opencode" (baseUrl https://opencode.ai/zen/v1) is Zen.
 * Usage:
 *   bun scripts/sync-from-pi.ts            # check
 *   bun scripts/sync-from-pi.ts --write    # update files
 *   bun run sync:pi                        # alias for --check
 *   bun run sync:pi:write                  # alias for --write
 */
import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const WRITE = process.argv.includes("--write");
const VERBOSE = process.argv.includes("--verbose");
const HERE = path.dirname(fileURLToPath(import.meta.url));

type PiModel = {
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

type PiData = Record<string, Record<string, PiModel>>;

function log(...args: unknown[]) {
  console.log(...args);
}
function vlog(...args: unknown[]) {
  if (VERBOSE) console.log(...args);
}

function findPiJsonLocal(): string | null {
  const homedir = os.homedir();
  const candidates = [
    path.join(
      homedir,
      ".bun/install/global/node_modules/@earendil-works/pi-ai/dist/providers/data/opencode.json",
    ),
    path.join(homedir, ".bun/install/cache"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      try {
        const entries = fs.readdirSync(c);
        for (const e of entries) {
          if (e.includes("pi-ai")) {
            const p = path.join(c, e, "dist/providers/data/opencode.json");
            if (fs.existsSync(p)) return p;
            const nested = findFileRecursive(path.join(c, e), "opencode.json");
            if (nested) return nested;
          }
        }
      } catch {}
    }
  }
  const harnessPaths = [
    path.join(homedir, "Projects/deepseek-harness/node_modules"),
    path.join(homedir, "Projects/opencode-zen-provider/node_modules"),
  ];
  for (const base of harnessPaths) {
    if (!fs.existsSync(base)) continue;
    const found = findFileRecursive(base, "opencode.json");
    if (found && found.includes("pi-ai")) return found;
  }
  try {
    const proc = spawnSync(
      "find",
      [homedir + "/.bun", "-name", "opencode.json", "-path", "*pi-ai*"],
      { encoding: "utf8" },
    );
    const out = String(proc.stdout ?? "")
      .trim()
      .split("\n")
      .filter(Boolean);
    if (out.length > 0) {
      const sorted = out.sort((a, b) => a.length - b.length);
      return sorted[0];
    }
  } catch {}
  return null;
}

function findFileRecursive(dir: string, filename: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isFile() && ent.name === filename) return full;
      if (ent.isDirectory() && !ent.name.startsWith(".") && ent.name !== "node_modules") {
        if (full.includes("pi-ai") && ent.name === "opencode.json") return full;
      }
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const sub = path.join(dir, ent.name);
        if (sub.includes("pi-ai") || ent.name === "@earendil-works" || ent.name === ".pnpm") {
          const res = findFileRecursive(sub, filename);
          if (res) return res;
        }
      }
    }
  } catch {}
  return null;
}

async function loadPiData(): Promise<{ data: PiData; source: string }> {
  const local = findPiJsonLocal();
  if (local && fs.existsSync(local)) {
    vlog(`Found Pi JSON locally: ${local}`);
    const data = JSON.parse(fs.readFileSync(local, "utf8")) as PiData;
    return { data, source: local };
  }
  const urls = [
    "https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai/dist/providers/data/opencode.json",
    "https://unpkg.com/@earendil-works/pi-ai/dist/providers/data/opencode.json",
  ];
  for (const url of urls) {
    try {
      vlog(`Fetching Pi JSON from ${url}`);
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as PiData;
        return { data, source: url };
      }
    } catch (e) {
      vlog(`Fetch failed ${url}: ${e}`);
    }
  }
  throw new Error("Could not locate Pi opencode.json locally or via CDN");
}

function flattenPi(data: PiData): Map<string, PiModel> {
  const map = new Map<string, PiModel>();
  for (const apiGroup of Object.values(data)) {
    for (const [id, model] of Object.entries(apiGroup)) {
      map.set(id, model);
    }
  }
  return map;
}

function piThinkingToEfforts(m: PiModel): string[] | null {
  if (!m.reasoning) return null;
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

function piApiToZen(api: string): { routeKind: string; apiFormat: string } {
  if (api === "anthropic-messages") return { routeKind: "messages", apiFormat: "anthropic" };
  if (api === "openai-responses") return { routeKind: "responses", apiFormat: "openai" };
  if (api === "google-generative-ai") return { routeKind: "model_specific", apiFormat: "openai" };
  return { routeKind: "chat_completions", apiFormat: "openai" };
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

// --- src/model-catalog.ts sync ---
function syncCatalog(
  piMap: Map<string, PiModel>,
  catalogPath: string,
  write: boolean,
): { changed: number; diffs: string[] } {
  let content = fs.readFileSync(catalogPath, "utf8");
  const diffs: string[] = [];
  let changed = 0;

  for (const [piId, piModel] of piMap.entries()) {
    const idRegex = new RegExp(`id:\\s*"${piId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
    if (!idRegex.test(content)) continue;

    const blockRegex = new RegExp(
      `\\{\\s*id:\\s*"${piId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?\\},`,
      "m",
    );
    const match = content.match(blockRegex);
    if (!match) continue;
    let block = match[0];
    const originalBlock = block;

    const expCtx = piModel.contextWindow;
    const expMax = piModel.maxTokens;
    const expVision = piModel.input.includes("image");
    const { routeKind: expRoute, apiFormat: expApi } = piApiToZen(piModel.api);
    const expThinking = piModel.reasoning;
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
    // Determine target thinking: if Pi has explicit map, use it; else keep current if generic null
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
    } else if (curThinking !== expThinking) {
      // No explicit map, but Pi reasoning differs
      if (expThinking !== curThinking) {
        // For big-pickle etc where Pi reasoning true but map null, we keep true (generic)
        // So only diff if Pi says false but we have true
        if (!expThinking && curThinking) {
          diffs.push(`${piId}: supportsThinking ${curThinking} -> ${expThinking}`);
          if (thinkingMatch) {
            block = block.replace(
              /supportsThinking:\s*(true|false),?/,
              `supportsThinking: ${expThinking},`,
            );
          }
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
    log(`Updated ${catalogPath} (${changed} blocks)`);
  }
  return { changed, diffs };
}

// --- docs/models.md sync ---
function syncDocs(
  piMap: Map<string, PiModel>,
  docsPath: string,
  write: boolean,
): { changed: number; diffs: string[] } {
  if (!fs.existsSync(docsPath)) return { changed: 0, diffs: [] };
  let content = fs.readFileSync(docsPath, "utf8");
  const diffs: string[] = [];
  let changed = 0;

  for (const [piId, piModel] of piMap.entries()) {
    const candidates = [
      piId
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      piModel.name,
    ];
    let rowMatch: RegExpMatchArray | null = null;
    let fullRow = "";
    for (const cand of candidates) {
      const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\|\\s*${escaped}\\s*\\|([^\\n]*\\n)`, "i");
      const m = content.match(re);
      if (m) {
        rowMatch = m;
        fullRow = m[0];
        break;
      }
    }
    if (!rowMatch) continue;
    const cells = fullRow.split("|").map((c) => c.trim());
    if (cells.length < 8) continue;

    const expCtxStr = formatNumber(piModel.contextWindow);
    const expMaxStr = formatNumber(piModel.maxTokens);
    const expVision = piModel.input.includes("image") ? "✓" : "✗";
    // Use piApiToZen routeKind to decide: responses => Responses, anthropic => Anthropic, else OpenAI
    const { routeKind } = piApiToZen(piModel.api);
    const expApiDisplay =
      routeKind === "responses" ? "Responses" : routeKind === "messages" ? "Anthropic" : "OpenAI";

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
    log(`Updated ${docsPath} (${changed} rows)`);
  }
  return { changed, diffs };
}

async function main() {
  const catalogPath = path.resolve(HERE, "../src/model-catalog.ts");
  const docsPath = path.resolve(HERE, "../docs/models.md");

  log(`🔍 Sync from Pi (opencode) — ${WRITE ? "WRITE" : "CHECK"} mode`);
  const { data, source } = await loadPiData();
  log(`Source: ${source}`);
  const piMap = flattenPi(data);
  log(`Pi models: ${piMap.size}`);

  const catalogRes = syncCatalog(piMap, catalogPath, WRITE);
  const docsRes = syncDocs(piMap, docsPath, WRITE);

  const allDiffs = [...catalogRes.diffs, ...docsRes.diffs];
  if (allDiffs.length === 0) {
    log("✅ No differences — already in sync with Pi");
  } else {
    log(`\nDifferences (${allDiffs.length}):`);
    for (const d of allDiffs.slice(0, 80)) log(`  - ${d}`);
    if (allDiffs.length > 80) log(`  ... and ${allDiffs.length - 80} more`);
    if (!WRITE) {
      log(`\nRun with --write to apply: bun scripts/sync-from-pi.ts --write`);
      log(`Or: bun run sync:pi:write`);
    } else {
      log(`\n✅ Applied ${catalogRes.changed} catalog blocks and ${docsRes.changed} doc rows`);
      log(`Next: bun run test && bun run compile`);
    }
  }
  if (!WRITE && allDiffs.length > 0) process.exit(1);
}

await main();
