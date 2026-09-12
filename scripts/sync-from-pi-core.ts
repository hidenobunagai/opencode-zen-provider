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

export function piThinkingToEfforts(m: PiModel): string[] | null {
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

export function piApiToZen(api: string): { routeKind: string; apiFormat: string } {
  if (api === "anthropic-messages") return { routeKind: "messages", apiFormat: "anthropic" };
  if (api === "openai-responses") return { routeKind: "responses", apiFormat: "openai" };
  if (api === "google-generative-ai") return { routeKind: "model_specific", apiFormat: "openai" };
  return { routeKind: "chat_completions", apiFormat: "openai" };
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
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
  }
  return { changed, diffs };
}
