/**
 * Smoke test script — verifies that all Zen models respond to a simple prompt.
 *
 * Usage:
 *   OPENCODE_ZEN_API_KEY=your-key bun run scripts/smoke.ts
 *   OPENCODE_ZEN_API_KEY=your-key bun run scripts/smoke.ts --model kimi-k2.6
 *   OPENCODE_ZEN_API_KEY=your-key bun run scripts/smoke.ts --verbose
 */

const BASE_URL = "https://opencode.ai/zen/v1";

// Responses-route models spend output tokens on reasoning before any text.
const MAX_TOKENS_BY_ROUTE: Record<string, number> = {
  responses: 2000,
};

import { ZEN_MODEL_CATALOG, type ZenModelInfo } from "../src/model-catalog";

function resolveEndpoint(routeKind: string, modelId: string): string {
  switch (routeKind) {
    case "chat_completions":
      return `${BASE_URL}/chat/completions`;
    case "messages":
      return `${BASE_URL}/messages`;
    case "responses":
      return `${BASE_URL}/responses`;
    case "model_specific":
      return `${BASE_URL}/models/${modelId}`;
    default:
      return `${BASE_URL}/chat/completions`;
  }
}

async function testModel(
  entry: ZenModelInfo,
  apiKey: string,
  verbose: boolean,
): Promise<{ ok: boolean; error?: string; text?: string }> {
  const endpoint = resolveEndpoint(entry.routeKind, entry.id);

  const body: Record<string, unknown> = {
    model: entry.requestModelId,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
    max_tokens: MAX_TOKENS_BY_ROUTE[entry.routeKind] ?? 10,
    stream: false,
  };

  if (entry.routeKind === "responses") {
    // Responses API uses input/max_output_tokens instead of messages/max_tokens.
    delete body.messages;
    delete body.max_tokens;
    body.input = [{ role: "user", content: "Reply with exactly: OK" }];
    body.max_output_tokens = MAX_TOKENS_BY_ROUTE.responses;
  }

  if (entry.routeKind === "messages") {
    body.messages = [{ role: "user", content: "Reply with exactly: OK" }];
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(entry.routeKind === "messages"
          ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    const responseText = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: `${response.status} ${response.statusText}: ${responseText.slice(0, 200)}`,
      };
    }

    let content: string | undefined;
    try {
      const json = JSON.parse(responseText);
      if (json.choices?.[0]?.message?.content) {
        content = json.choices[0].message.content;
      } else if (json.content?.[0]?.text) {
        content = json.content[0].text;
      } else if (json.output?.[0]?.content?.[0]?.text) {
        content = json.output[0].content[0].text;
      }
    } catch {
      content = responseText.slice(0, 100);
    }

    if (verbose && content) {
      console.log(`    Response: "${content.slice(0, 100)}"`);
    }

    return { ok: true, text: content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

async function main() {
  const apiKey = process.env.OPENCODE_ZEN_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENCODE_ZEN_API_KEY environment variable is required.");
    console.error("Usage: OPENCODE_ZEN_API_KEY=your-key bun run scripts/smoke.ts");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const modelFilter = args.find((a) => a.startsWith("--model="))?.split("=")[1];

  const targets = modelFilter
    ? ZEN_MODEL_CATALOG.filter((m) => m.id === modelFilter)
    : ZEN_MODEL_CATALOG;

  if (targets.length === 0) {
    console.error(`No models found matching "${modelFilter}"`);
    process.exit(1);
  }

  console.log(`\nOpenCode Zen Provider — Smoke Test`);
  console.log(`Testing ${targets.length} model(s)...\n`);

  const results: { model: string; ok: boolean; error?: string }[] = [];

  for (const entry of targets) {
    const prefix = verbose ? `  [....] ${entry.displayName} (${entry.id})` : "";
    if (verbose) process.stdout.write(prefix + "\r");

    const start = Date.now();
    const result = await testModel(entry, apiKey, verbose);
    const elapsed = Date.now() - start;

    results.push({ model: entry.id, ok: result.ok, error: result.error });

    const status = result.ok ? "PASS" : "FAIL";
    const icon = result.ok ? "✓" : "✗";
    console.log(`  [${status}] ${icon} ${entry.displayName} (${entry.id}) — ${elapsed}ms`);
    if (result.error && !verbose) {
      console.log(`         Error: ${result.error}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${targets.length} total\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
