#!/usr/bin/env bun
/**
 * Mirror the OpenCode Zen catalog against what Zen actually serves.
 *
 * - The mirror: `GET https://opencode.ai/zen/v1/models` decides which ids belong in the
 *   catalog. A model Zen serves but the catalog omits, and an id the catalog keeps after Zen
 *   dropped it, are both drift — neither is visible from field comparison, which is how 67
 *   served models stayed unlisted while this gate reported "in sync with Pi" every morning
 *   (measured 2026-10-21: catalog 22, Zen 86).
 * - Field comparison against Pi's opencode.json still runs (`syncCatalog` / `syncDocs`): Pi is
 *   the metadata source for the ids it knows, and its values win over models.dev.
 * - models.dev covers the gap Pi leaves: a model Zen has just released, which Pi has not
 *   picked up yet (`loadModelsDev`). It is only consulted for ids Pi does not describe — the
 *   earlier note that it disagreed on 8 of 25 entries still holds, so it never overrides Pi.
 *   A model neither source describes is reported and left out rather than guessed.
 * - Default: --check (report drift, exit 1). With --write, retires dropped ids, appends the
 *   missing ones, and regenerates the docs `## Model List` table from the catalog.
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
  appendCatalogBlocks,
  catalogIds,
  catalogIdsMissingFromPi,
  entryFromModelsDev,
  entryFromPi,
  flattenPi,
  mirrorDrift,
  parseCatalog,
  servableIds,
  splitUnaddable,
  removeCatalogEntry,
  renderCatalogBlock,
  renderModelListSection,
  replaceModelListSection,
  syncCatalog,
  syncDocs,
  unverifiedEfforts,
  type ModelsDevModel,
  type PiData,
} from "./sync-from-pi-core";
import { loadDecisions } from "./effort-decisions";
import { loadPiAiData } from "./pi-ai-source";

const WRITE = process.argv.includes("--write");
const VERBOSE = process.argv.includes("--verbose");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";
const MODELS_DEV_URL = "https://models.dev/api.json";

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

/**
 * models.dev's `opencode` provider, keyed by model id. Zen's own endpoint returns ids only, so
 * this is the second metadata source when Pi does not carry a model Zen has just released.
 * `null` means it could not be read; the caller then refuses to invent an entry.
 */
async function loadModelsDev(): Promise<Map<string, ModelsDevModel> | null> {
  try {
    const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      vlog(`models.dev returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      opencode?: { models?: Record<string, ModelsDevModel> };
    };
    const models = body.opencode?.models;
    if (!models) return null;
    const map = new Map<string, ModelsDevModel>();
    for (const [id, m] of Object.entries(models)) map.set(m.id || id, { ...m, id: m.id || id });
    return map.size > 0 ? map : null;
  } catch (e) {
    vlog(`models.dev fetch failed: ${e}`);
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

  let catalogContent = fs.readFileSync(catalogPath, "utf8");

  // The mirror: what Zen serves versus what the catalog lists. Both directions are drift —
  // a model Zen serves but the extension omits is one the user cannot pick, and an id Zen
  // has dropped is one the picker offers and every request fails on. Comparing field values
  // can never catch either, which is how 67 models accumulated unlisted while the gate
  // reported "in sync with Pi" every morning (measured 2026-10-21: catalog 22, Zen 86).
  const zenIds = await loadZenModelIds();
  let mirrorMissing: string[] = [];
  let mirrorRetired: string[] = [];
  let modelsDev: Map<string, ModelsDevModel> | null = null;
  if (!zenIds) {
    log(`\n⚠️  could not read ${ZEN_MODELS_URL} — the served-vs-catalog check is skipped`);
  } else {
    const drift = mirrorDrift(servableIds(zenIds), catalogIds(catalogContent));
    // Classify the served-but-unlisted ids before calling any of them drift. Two groups can
    // never be mirrored automatically — a transport with no client here, and an id that
    // neither Pi nor models.dev describes (Zen's list is ids only, so its limits are unknown).
    // Reporting those as drift would wake the daily updater every morning over work no run
    // can finish.
    const { addable, unaddable } = splitUnaddable(drift.missing, piMap);
    if (addable.length > 0) modelsDev = await loadModelsDev();
    const described: string[] = [];
    const undescribed: string[] = [];
    for (const id of addable) {
      if (piMap.has(id) || modelsDev?.has(id)) described.push(id);
      else undescribed.push(id);
    }
    mirrorMissing = described;
    mirrorRetired = drift.retired;

    if (mirrorMissing.length === 0 && mirrorRetired.length === 0) {
      log(`\n✅ Catalog lists every model Zen serves that this extension can speak`);
    } else {
      log(`\nCatalog is not a mirror of ${ZEN_MODELS_URL}:`);
      if (mirrorMissing.length > 0) {
        log(`  ${mirrorMissing.length} served by Zen but missing from the catalog:`);
        log(`    ${mirrorMissing.join(", ")}`);
      }
      if (mirrorRetired.length > 0) {
        log(`  ${mirrorRetired.length} in the catalog but no longer served (retire them):`);
        log(`    ${mirrorRetired.join(", ")}`);
      }
    }
    if (unaddable.length > 0) {
      log(
        `\nℹ️  ${unaddable.length} served model(s) cannot be mirrored — no client for their Pi transport: ${unaddable.join(", ")}`,
      );
    }
    if (undescribed.length > 0) {
      log(
        `\nℹ️  ${undescribed.length} served model(s) cannot be mirrored — neither Pi nor models.dev describes them: ${undescribed.join(", ")}`,
      );
    }
  }

  if (WRITE && zenIds) {
    // Retire first: a model Zen dropped must not keep a row, and its block has to go before
    // the new ones are appended.
    for (const id of mirrorRetired) {
      catalogContent = removeCatalogEntry(catalogContent, id);
    }
    // Metadata for each missing id: Pi when it has the model, models.dev when it does not.
    const newBlocks: string[] = [];
    for (const id of mirrorMissing) {
      const pi = piMap.get(id);
      if (pi) {
        newBlocks.push(renderCatalogBlock(entryFromPi(pi)));
        continue;
      }
      const md = modelsDev?.get(id);
      if (md) newBlocks.push(renderCatalogBlock(entryFromModelsDev(md)));
    }
    catalogContent = appendCatalogBlocks(catalogContent, newBlocks);
    fs.writeFileSync(catalogPath, catalogContent, "utf8");
    log(`\n✅ Catalog updated: retired ${mirrorRetired.length}, added ${newBlocks.length}`);

    // Regenerate the model list from the catalog that was just written.
    const docsContent = fs.readFileSync(docsPath, "utf8");
    const section = renderModelListSection(parseCatalog(catalogContent));
    const nextDocs = replaceModelListSection(docsContent, section);
    if (nextDocs !== docsContent) {
      fs.writeFileSync(docsPath, nextDocs, "utf8");
      log(`Updated ${path.relative(path.resolve(HERE, ".."), docsPath)} (Model List section)`);
    }
  }

  const mirrorOk = zenIds && mirrorMissing.length === 0 && mirrorRetired.length === 0;

  // Warn-only: Pi cannot describe a model the catalog lists, but Zen may still serve it (the
  // mirror above settles that), so this only says which fields Pi cannot vouch for.
  const catalogOnly = catalogIdsMissingFromPi(catalogContent, piMap);
  if (catalogOnly.length > 0 && !mirrorOk) {
    log(
      `\nℹ️  ${catalogOnly.length} catalog entries are absent from Pi, so only the Zen list vouches for them:`,
    );
    log(`  ${catalogOnly.join(", ")}`);
  }

  // Warn-only, like the section above: Pi carries only its generic reasoning default for these
  // models and no decision records a ladder, so their picker is unverified. Research one model
  // at a time (see docs/models.md "Thinking efforts") rather than failing the gate over all of them.
  const unverified = unverifiedEfforts(catalogContent, piMap, decisions);
  if (unverified.length > 0) {
    log(
      `\n⚠️  ${unverified.length} catalog models rest on no ladder evidence (Pi is generic, no decision) — record one in docs/effort-decisions.json (docs/models.md "Thinking efforts") when touching them:`,
    );
    log(`  ${unverified.join(", ")}`);
  }

  if (!WRITE && !mirrorOk) process.exit(1);
}

await main();
