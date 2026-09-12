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
import { flattenPi, syncCatalog, syncDocs, type PiData } from "./sync-from-pi-core";

const WRITE = process.argv.includes("--write");
const VERBOSE = process.argv.includes("--verbose");
const HERE = path.dirname(fileURLToPath(import.meta.url));

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

async function main() {
  const catalogPath = path.resolve(HERE, "../src/model-catalog.ts");
  const docsPath = path.resolve(HERE, "../docs/models.md");

  log(`🔍 Sync from Pi (opencode) — ${WRITE ? "WRITE" : "CHECK"} mode`);
  const { data, source } = await loadPiData();
  log(`Source: ${source}`);
  const piMap = flattenPi(data);
  log(`Pi models: ${piMap.size}`);

  const catalogRes = syncCatalog(piMap, catalogPath, WRITE);
  if (WRITE && catalogRes.changed > 0) log(`Updated ${catalogPath} (${catalogRes.changed} blocks)`);
  const docsRes = syncDocs(piMap, docsPath, WRITE);
  if (WRITE && docsRes.changed > 0) log(`Updated ${docsPath} (${docsRes.changed} rows)`);

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
