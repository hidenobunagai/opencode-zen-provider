/**
 * Smoke test script — verifies that all Zen models respond to a simple prompt.
 *
 * Usage:
 *   OPENCODE_ZEN_API_KEY=your-key bun run scripts/smoke.ts
 *   OPENCODE_ZEN_API_KEY=your-key bun run scripts/smoke.ts --model kimi-k2.6
 *   OPENCODE_ZEN_API_KEY=your-key bun run scripts/smoke.ts --verbose
 */

const BASE_URL = "https://opencode.ai/zen/v1";

interface ZenModelEntry {
  id: string;
  requestModelId: string;
  displayName: string;
  routeKind: "responses" | "messages" | "chat_completions" | "model_specific";
  apiFormat: "openai" | "anthropic";
}

const MODELS: ZenModelEntry[] = [
  {
    id: "big-pickle",
    requestModelId: "big-pickle",
    displayName: "Big Pickle",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
  {
    id: "claude-opus-4-7",
    requestModelId: "claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    routeKind: "messages",
    apiFormat: "anthropic",
  },
  {
    id: "claude-sonnet-4-6",
    requestModelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    routeKind: "messages",
    apiFormat: "anthropic",
  },
  {
    id: "gemini-3-flash",
    requestModelId: "gemini-3-flash",
    displayName: "Gemini 3 Flash",
    routeKind: "model_specific",
    apiFormat: "openai",
  },
  {
    id: "gemini-3.1-pro",
    requestModelId: "gemini-3.1-pro",
    displayName: "Gemini 3.1 Pro",
    routeKind: "model_specific",
    apiFormat: "openai",
  },
  {
    id: "glm-5.1",
    requestModelId: "glm-5.1",
    displayName: "GLM 5.1",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
  {
    id: "gpt-5.4",
    requestModelId: "gpt-5.4",
    displayName: "GPT 5.4",
    routeKind: "responses",
    apiFormat: "openai",
  },
  {
    id: "gpt-5.4-mini",
    requestModelId: "gpt-5.4-mini",
    displayName: "GPT 5.4 Mini",
    routeKind: "responses",
    apiFormat: "openai",
  },
  {
    id: "gpt-5.4-nano",
    requestModelId: "gpt-5.4-nano",
    displayName: "GPT 5.4 Nano",
    routeKind: "responses",
    apiFormat: "openai",
  },
  {
    id: "gpt-5.4-pro",
    requestModelId: "gpt-5.4-pro",
    displayName: "GPT 5.4 Pro",
    routeKind: "responses",
    apiFormat: "openai",
  },
  {
    id: "gpt-5.5",
    requestModelId: "gpt-5.5",
    displayName: "GPT 5.5",
    routeKind: "responses",
    apiFormat: "openai",
  },
  {
    id: "gpt-5.5-pro",
    requestModelId: "gpt-5.5-pro",
    displayName: "GPT 5.5 Pro",
    routeKind: "responses",
    apiFormat: "openai",
  },
  {
    id: "hy3-preview-free",
    requestModelId: "hy3-preview-free",
    displayName: "Hy3 Preview Free",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
  {
    id: "kimi-k2.6",
    requestModelId: "kimi-k2.6",
    displayName: "Kimi K2.6",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
  {
    id: "ling-2.6-flash-free",
    requestModelId: "ling-2.6-flash-free",
    displayName: "Ling 2.6 Flash Free",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
  {
    id: "minimax-m2.5",
    requestModelId: "minimax-m2.5",
    displayName: "MiniMax M2.5",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
  {
    id: "minimax-m2.5-free",
    requestModelId: "minimax-m2.5-free",
    displayName: "MiniMax M2.5 Free",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
  {
    id: "minimax-m2.7",
    requestModelId: "minimax-m2.7",
    displayName: "MiniMax M2.7",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
  {
    id: "nemotron-3-super-free",
    requestModelId: "nemotron-3-super-free",
    displayName: "Nemotron 3 Super Free",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
  {
    id: "qwen3.6-plus",
    requestModelId: "qwen3.6-plus",
    displayName: "Qwen3.6 Plus",
    routeKind: "chat_completions",
    apiFormat: "openai",
  },
];

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
  entry: ZenModelEntry,
  apiKey: string,
  verbose: boolean,
): Promise<{ ok: boolean; error?: string; text?: string }> {
  const endpoint = resolveEndpoint(entry.routeKind, entry.id);

  const body: Record<string, unknown> = {
    model: entry.requestModelId,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
    max_tokens: 10,
    stream: false,
  };

  if (entry.routeKind === "messages") {
    body.max_tokens = 10;
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

  const targets = modelFilter ? MODELS.filter((m) => m.id === modelFilter) : MODELS;

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
