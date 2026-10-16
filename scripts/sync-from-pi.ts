#!/usr/bin/env bun
/**
 * Sync from Pi's opencode.json to opencode-zen-provider.
 * - Compares Pi's provider data (contextWindow/maxTokens/vision/api/thinkingLevelMap)
 *   with ZEN_MODEL_CATALOG in src/model-catalog.ts and docs/models.md tables.
 * - Also reports catalog ids that Pi does not contain: those entries are skipped by
 *   syncCatalog, so the live Zen model list is the only thing that can tell a lagging Pi
 *   (model still served) from a dead entry left behind in the picker.
 * - Warn-only: also compares every docs row with the catalog entry it documents, since
 *   syncDocs only reaches rows whose model Pi knows and syncCatalog cannot rewrite a block
 *   its regex does not match.
 * - models.dev is deliberately not a third source (measured 2026-09-15 against
 *   https://models.dev/api.json, provider `opencode`): it disagrees with the catalog on 8 of
 *   25 entries, and 5 of those (Gemini 3.x, grok-build-0.1: `reasoning: true` while the
 *   catalog and docs say Thinking ✗) are entries the two existing sources agree on, so the
 *   flag means something else. For the 4 entries Pi cannot check it would add 6 lines that
 *   Zen's id-only list cannot arbitrate: `limit.context` / `limit.output` disagree with both
 *   the catalog and docs for deepseek-v4-flash-free (200,000/128,000) and laguna-s-2.1-free,
 *   and side with docs only for x-preview-f-free (the latter two retired 2026-09-16, so only
 *   deepseek-v4-flash-free is left to arbitrate). Revisit only if a human wants that opinion.
 * - Default: --check (report diff). With --write, updates src/model-catalog.ts and docs/models.md.
 *
 * Pi source: the latest published pi-ai from npm/CDN, falling back to the newest local
 * copy when offline (see scripts/pi-ai-source.ts).
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
import { fileURLToPath } from "url";
import {
  flattenPi,
  syncCatalog,
  syncDocs,
  catalogIdsMissingFromPi,
  catalogDocsDiffs,
  unverifiedEfforts,
  type PiData,
} from "./sync-from-pi-core";
import { loadDecisions } from "./effort-decisions";
import { loadPiAiData } from "./pi-ai-source";

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
  const { data, source } = await loadPiAiData<PiData>("opencode.json");
  log(`Source: ${source}`);
  const piMap = flattenPi(data);
  log(`Pi models: ${piMap.size}`);

  // Researched ladders win over Pi's map; without the file every model falls back to Pi.
  const decisionsPath = path.resolve(HERE, "../docs/effort-decisions.json");
  const decisions = loadDecisions(decisionsPath);
  const decided = Object.keys(decisions).length;
  if (decided > 0) log(`Effort decisions: ${decided} (${decisionsPath})`);

  const catalogRes = syncCatalog(piMap, catalogPath, WRITE, decisions);
  if (WRITE && catalogRes.changed > 0) log(`Updated ${catalogPath} (${catalogRes.changed} blocks)`);
  const docsRes = syncDocs(piMap, docsPath, WRITE, decisions);
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

  const catalogContent = fs.readFileSync(catalogPath, "utf8");

  // Warn-only: dropping a model is a product decision (the free tier in particular moves
  // without Pi), so this stays out of the diffs and cannot fail --check.
  const catalogOnly = catalogIdsMissingFromPi(catalogContent, piMap);
  if (catalogOnly.length > 0) {
    const zenIds = await loadZenModelIds();
    log(
      `\n⚠️  ${catalogOnly.length} catalog entries are absent from Pi, so Pi cannot check any field in them:`,
    );
    if (!zenIds) log(`  (could not read ${ZEN_MODELS_URL} — reporting ids only)`);
    for (const id of catalogOnly) {
      if (!zenIds) log(`  - ${id}`);
      else if (zenIds.has(id)) log(`  - ${id}: still served by Zen (Pi data lags behind)`);
      else
        log(`  - ${id}: NOT served by Zen — retire it from src/model-catalog.ts, docs/models.md`);
    }
  }

  // Warn-only: nothing can pick a winner. `syncDocs` only reaches rows whose model Pi knows
  // and `syncCatalog` cannot reach a commented block, while Zen returns ids alone, so the
  // catalog and its own docs row drift apart with no side clearly right.
  const docsDiffs = catalogDocsDiffs(catalogContent, fs.readFileSync(docsPath, "utf8"));
  if (docsDiffs.size > 0) {
    log(`\n⚠️  ${docsDiffs.size} catalog entries disagree with their docs row in docs/models.md:`);
    for (const [id, diffs] of docsDiffs) for (const d of diffs) log(`  - ${id}: ${d}`);
  }

  // Warn-only, like the sections above: Pi carries only its generic reasoning default for these
  // models and no decision records a ladder, so their picker is unverified. Research one model
  // at a time (see docs/models.md "Thinking efforts") rather than failing the gate over all of them.
  const unverified = unverifiedEfforts(catalogContent, piMap, decisions);
  if (unverified.length > 0) {
    log(
      `\n⚠️  ${unverified.length} catalog models rest on no ladder evidence (Pi is generic, no decision) — record one in docs/effort-decisions.json (docs/models.md "Thinking efforts") when touching them:`,
    );
    log(`  ${unverified.join(", ")}`);
  }
}

await main();
