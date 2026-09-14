#!/usr/bin/env bun
/**
 * Sync from Pi's opencode.json to opencode-zen-provider.
 * - Compares Pi's provider data (contextWindow/maxTokens/vision/api/thinkingLevelMap)
 *   with ZEN_MODEL_CATALOG in src/model-catalog.ts and docs/models.md tables.
 * - Also reports catalog ids that Pi does not contain: those entries are skipped by
 *   syncCatalog, so the live Zen model list is the only thing that can tell a lagging Pi
 *   (model still served) from a dead entry left behind in the picker.
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
import {
  flattenPi,
  syncCatalog,
  syncDocs,
  catalogIdsMissingFromPi,
  type PiData,
} from "./sync-from-pi-core";

const WRITE = process.argv.includes("--write");
const VERBOSE = process.argv.includes("--verbose");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";

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

/**
 * Ids the Zen API currently serves. `null` means the list could not be read, so callers
 * report the ids without claiming anything about whether Zen still serves them.
 */
async function loadZenModelIds(): Promise<Set<string> | null> {
  try {
    const res = await fetch(ZEN_MODELS_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      vlog(`Zen model list ${ZEN_MODELS_URL} returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string");
    return ids.length > 0 ? new Set(ids) : null;
  } catch (e) {
    vlog(`Zen model list fetch failed: ${e}`);
    return null;
  }
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

  // Warn-only: dropping a model is a product decision (the free tier in particular moves
  // without Pi), so this stays out of the diffs and cannot fail --check.
  const catalogOnly = catalogIdsMissingFromPi(fs.readFileSync(catalogPath, "utf8"), piMap);
  if (catalogOnly.length === 0) return;
  const zenIds = await loadZenModelIds();
  log(
    `\n⚠️  ${catalogOnly.length} catalog entries are absent from Pi, so no field in them (or in their docs row) is checked:`,
  );
  if (!zenIds) log(`  (could not read ${ZEN_MODELS_URL} — reporting ids only)`);
  for (const id of catalogOnly) {
    if (!zenIds) log(`  - ${id}`);
    else if (zenIds.has(id)) log(`  - ${id}: still served by Zen (Pi data lags behind)`);
    else log(`  - ${id}: NOT served by Zen — retire it from src/model-catalog.ts, docs/models.md`);
  }
}

await main();
