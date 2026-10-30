# Supported Models

The extension bundles a static `ZEN_MODEL_CATALOG` in `src/model-catalog.ts` that mirrors the models served by the OpenCode Zen API (`https://opencode.ai/zen/v1`). Each model entry specifies its route kind (`responses` / `messages` / `chat_completions` / `model_specific`), API format (`openai` / `anthropic`), context window, max output, vision/tool/thinking support, and any fixed temperature.

Catalog last synced with the API on 2026-10-31.

## Thinking efforts

The Thinking column and the picker's `supportedReasoningEfforts` come from one of three sources,
in this order:

1. **`docs/effort-decisions.json`** — researched ladders, one entry per model:
   `"<id>": { "efforts": ["low", "high", "max"], "source": "<vendor doc URL / probe date>", "decided": "YYYY-MM-DD" }`.
   A decision always wins, so a researched ladder also survives a Pi regression.
   `"efforts": []` is a decision too: it records that the vendor offers no ladder (no picker).
2. **Pi's explicit `thinkingLevelMap`** (`opencode.json` in the pi-ai install) — the levels the
   vendor's own provider file declares; `sync:pi` copies them.
3. **Pi's generic default** (`reasoning: true`, no map) — nothing states the rungs. The sync
   leaves such an entry alone and lists it under `no ladder evidence`. That list is a **warning,
   not drift**: the Zen free tier refuses every request made outside OpenCode, the paid models need
   credit, and OpenCode's `#variant` list is itself built from models.dev — so a gap in models.dev
   cannot be arbitrated from here.

   **Read every protocol page, not just one.** A vendor splits its API reference by protocol
   (Chat Completions / Responses / Anthropic Messages) and the effort parameter can be
   documented on only one of them. Xiaomi documents `thinking: { type: enabled | disabled }`
   on the chat-completions and anthropic pages and `reasoning.effort` — with
   `none,minimal,low,medium,high,xhigh,max,ultra` — only on the Responses page; reading the
   first two produced an empty ladder for `mimo-v2.6-flash-free`, which was wrong.

   Record a decision only when a primary source states the ladder, and only for this gateway's
   transport (a ladder from another gateway does not carry over).
   A ladder published for Command Code, OpenRouter, or a vendor's raw API does not transfer: each
   gateway accepts its own set of rungs. Xiaomi, for instance, documents only
   `thinking: { type: enabled | disabled }` — no `reasoning_effort` at all — which is why
   `mimo-v2.6-flash-free` records an empty ladder.

`efforts: []` does not mean "does not think": it means the vendor exposes no effort parameter
(Sonnet 4.5, Haiku 4.5, GLM-5/5.1, Kimi K2.5–K2.7 Code think on/off with no ladder), so the
picker stays off and the gateway default applies.

The rungs are the gateway's own enum (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`); the
provider drops a configured value that is not in `supportedReasoningEfforts` at request time.

## Model List

One row per entry in `ZEN_MODEL_CATALOG`, sorted by model id. This table is generated:
`bun run sync:pi:write` rewrites it from the catalog, so edit `src/model-catalog.ts`
rather than the table.

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| Beam Free | 1,048,576 | 131,072 | ✗ | ✓ | ✓ (`low,medium,high,xhigh,max`) | OpenAI |
| Big Pickle | 200,000 | 32,000 | ✗ | ✗ | ✗ | OpenAI |
| Claude Fable 5 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`xhigh,max`) | Anthropic |
| Claude Fable 5.1 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`xhigh,max`) | Anthropic |
| Claude Haiku 4.5 | 200,000 | 64,000 | ✓ | ✓ | ✗ | Anthropic |
| Claude Haiku 5.5 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`xhigh,max`) | Anthropic |
| Claude Opus 4.5 | 200,000 | 64,000 | ✓ | ✓ | ✓ (`low,medium,high`) | Anthropic |
| Claude Opus 4.6 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`max`) | Anthropic |
| Claude Opus 4.7 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`xhigh,max`) | Anthropic |
| Claude Opus 4.8 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`xhigh,max`) | Anthropic |
| Claude Opus 5 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`xhigh,max`) | Anthropic |
| Claude Opus 5.5 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`xhigh,max`) | Anthropic |
| Claude Sonnet 4.5 | 200,000 | 64,000 | ✓ | ✓ | ✗ | Anthropic |
| Claude Sonnet 4.6 | 1,000,000 | 64,000 | ✓ | ✓ | ✓ (`max`) | Anthropic |
| Claude Sonnet 5 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`xhigh,max`) | Anthropic |
| Claude Sonnet 5.5 | 1,000,000 | 128,000 | ✓ | ✓ | ✓ (`xhigh,max`) | Anthropic |
| DeepSeek V4 Pro | 1,000,000 | 384,000 | ✗ | ✓ | ✓ (`high,max`) | OpenAI |
| DeepSeek V4.1 Flash | 1,000,000 | 384,000 | ✓ | ✓ | ✓ (`low,high,max`) | OpenAI |
| DeepSeek V4.1 Flash Free | 200,000 | 32,000 | ✓ | ✓ | ✓ (`low,high,max`) | OpenAI |
| Flint 40B Free | 262,144 | 65,536 | ✗ | ✓ | ✓ (`low,medium,high,xhigh,max`) | OpenAI |
| Gemini 3.5 Flash | 1,048,576 | 65,536 | ✓ | ✓ | ✓ (`minimal,low,medium,high`) | OpenAI |
| Gemini 3.5 Flash Lite | 1,048,576 | 65,536 | ✓ | ✓ | ✓ (`minimal,low,medium,high`) | OpenAI |
| Gemini 3.6 Flash | 1,048,576 | 65,536 | ✓ | ✓ | ✓ (`minimal,low,medium,high`) | OpenAI |
| Gemini 3.7 Flash | 1,048,576 | 65,536 | ✓ | ✓ | ✓ (`low,medium,high`) | OpenAI |
| Gemini 3.8 Flash | 1,048,576 | 65,536 | ✓ | ✓ | ✓ (`low,medium,high`) | OpenAI |
| Gemini 4 Argon | 1,048,576 | 65,536 | ✓ | ✓ | ✓ (`low,medium,high`) | OpenAI |
| GLM-5 | 204,800 | 131,072 | ✗ | ✓ | ✗ | OpenAI |
| GLM-5.1 | 204,800 | 131,072 | ✗ | ✓ | ✗ | OpenAI |
| GLM 5.2 | 1,000,000 | 131,072 | ✗ | ✓ | ✓ (`high,max`) | OpenAI |
| GLM-5.3 | 1,000,000 | 131,072 | ✗ | ✓ | ✓ (`low,high,max`) | OpenAI |
| GLM-5.3-Flash | 1,000,000 | 131,072 | ✓ | ✓ | ✓ (`low,high,max`) | OpenAI |
| GLM-5.3-Flash Free | 200,000 | 32,000 | ✓ | ✓ | ✓ (`low,high,max`) | OpenAI |
| GPT-5 | 400,000 | 128,000 | ✓ | ✓ | ✓ (`minimal,low,medium,high`) | Responses |
| GPT-5 Codex | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high`) | Responses |
| GPT-5 Nano | 400,000 | 128,000 | ✓ | ✓ | ✓ (`minimal,low,medium,high`) | Responses |
| GPT-5.1 | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high`) | Responses |
| GPT-5.1 Codex | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high`) | Responses |
| GPT-5.1 Codex Max | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| GPT-5.1 Codex Mini | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high`) | Responses |
| GPT-5.2 | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| GPT-5.2 Codex | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| GPT-5.3 Codex | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| GPT-5.3 Codex Spark | 128,000 | 128,000 | ✗ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| GPT-5.4 | 272,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| GPT-5.4 Mini | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| GPT-5.4 Nano | 400,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| GPT-5.4 Pro | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`medium,high,xhigh`) | Responses |
| GPT-5.5 | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| GPT-5.5 Pro | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`medium,high,xhigh`) | Responses |
| GPT 5.6 Luna | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh,max`) | Responses |
| GPT 5.6 Sol | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh,max`) | Responses |
| GPT 5.6 Terra | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh,max`) | Responses |
| GPT-6 Astra | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh,max`) | Responses |
| GPT-6 Luna | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh,max`) | Responses |
| GPT-6 Sol | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh,max`) | Responses |
| GPT-6.1 Sol | 1,050,000 | 128,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh,max`) | Responses |
| Grok 4.5 | 500,000 | 500,000 | ✓ | ✓ | ✓ (`low,medium,high`) | Responses |
| Grok 4.6 | 500,000 | 500,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| Grok 4.7 | 500,000 | 500,000 | ✓ | ✓ | ✓ (`low,medium,high,xhigh`) | Responses |
| Grok Build 0.1 | 256,000 | 256,000 | ✓ | ✓ | ✗ | Responses |
| Kimi K2.5 | 262,144 | 65,536 | ✓ | ✓ | ✗ | OpenAI |
| Kimi K2.6 | 262,144 | 65,536 | ✓ | ✓ | ✗ | OpenAI |
| Kimi K2.7 Code | 262,144 | 262,144 | ✓ | ✓ | ✗ | OpenAI |
| Kimi K3 | 1,048,576 | 131,072 | ✓ | ✓ | ✓ (`low,high,max`) | OpenAI |
| MiMo-V2.6-Flash Free | 200,000 | 32,000 | ✓ | ✓ | ✓ (`low,medium,high`) | OpenAI |
| MiniMax-M2.5 | 204,800 | 131,072 | ✗ | ✓ | ✗ | OpenAI |
| MiniMax-M2.7 | 204,800 | 131,072 | ✗ | ✓ | ✗ | OpenAI |
| MiniMax M3 | 512,000 | 128,000 | ✓ | ✓ | ✗ | OpenAI |
| Mistral Large 4 | 524,288 | 262,144 | ✓ | ✓ | ✓ (`high`) | OpenAI |
| Muse Spark 1.2 | 1,048,576 | 131,072 | ✓ | ✓ | ✓ (`minimal,low,medium,high,xhigh`) | Responses |
| Muse Spark 1.3 | 1,048,576 | 131,072 | ✓ | ✓ | ✓ (`minimal,low,medium,high,xhigh`) | Responses |
| Muse Wonder | 1,048,576 | 131,072 | ✓ | ✓ | ✓ (`minimal,low,medium,high,xhigh,max`) | Responses |
| Nemotron 3.5 Lightning Free | 262,144 | 262,144 | ✗ | ✗ | ✗ | OpenAI |
| Nemotron 3.5 Super VL Free | 1,048,576 | 131,072 | ✓ | ✓ | ✓ (`minimal,low,medium,high,xhigh`) | OpenAI |
| Qwen3.5 Plus | 262,144 | 65,536 | ✓ | ✓ | ✗ | Anthropic |
| Qwen3.6 Plus | 262,144 | 65,536 | ✓ | ✓ | ✗ | Anthropic |
| Qwen3.8 Flash | 1,000,000 | 131,072 | ✓ | ✓ | ✓ (`low,medium,xhigh`) | Anthropic |
| Qwen3.8 Max | 262,144 | 131,072 | ✓ | ✓ | ✓ (`low,medium,xhigh`) | OpenAI |

Family notes (the table above cannot carry them, so they live here):

- **DeepSeek V4+** require `REASONING_CONTENT_WORKAROUND_MODELS` for correct streaming output.
  System prompts are sanitized to replace "Claude"/"Anthropic" references.
- **Gemini** use the model-specific route (`/models/{id}`) — the API column reads "OpenAI"
  because that is the request format, not the endpoint.
- **GPT** and **Grok** use the **Responses API** route (`/responses`) and internally reason, so
  they count as thinking models (`THINKING_MODELS`) for output budget purposes.
- **Kimi** use `fixedTemperature: 1` and require `REASONING_CONTENT_WORKAROUND_MODELS` (all but
  K2.5) for correct streaming output.
- **Muse Spark 1.2** uses the Responses route and counts as a thinking model.
- **Tool-less models** (`NO_TOOL_MODEL_IDS`: Big Pickle, Nemotron 3.5 Lightning Free) declare
  `toolCalling` so they appear in the picker, but the provider strips tools before sending.
  Other `-free` models do support tools and vision.

## Removed from the API

The catalog mirrors `GET https://opencode.ai/zen/v1/models`: an id appears in the table above if
and only if Zen lists it, minus the two ids that are not pickable models (`test`, a reachability
probe, and `claude-opus-5-5-backup`, a failover copy of `claude-opus-5-5`). `bun run sync:pi`
reports any difference in either direction as drift, and `sync:pi:write` retires what Zen
dropped and appends what it added.

Currently unserved, and therefore absent: `claude-opus-4-1`, `ling-3.0-flash-free`,
`north-mini-code-free`, `hy3-free`, `laguna-s-2.1-free`, `x-preview-f-free`.

> **Why the earlier list here was wrong.** Until 2026-10-21 this section named the Claude,
> Gemini 3.1 Pro / 3.5 Flash, GPT-5.x, GLM-5/5.1, Kimi K2.5–K2.7 Code, MiniMax M2.5/M2.7 and
> Qwen3.5/3.6 Plus families as removed, and `tests/model-catalog.test.ts` asserted their
> absence. Zen serves all of them again. Because the test and this document agreed with each
> other, nothing noticed that the catalog itself had fallen 60 models behind the API. Do not
> restore per-id absence assertions here — the mirror gate in `scripts/sync-from-pi.ts` is what
> keeps this section honest.

## Model Quirks & Workarounds

The extension applies several model-behavior workarounds while streaming. This matrix summarizes which workaround applies to which model family, and where it lives:

| Workaround | Applies to | Where |
|------------|-----------|-------|
| `reasoning_content` field added to assistant history, and parsed from streaming deltas | Kimi (except K2.5), DeepSeek V4+, Flint (`REASONING_CONTENT_WORKAROUND_MODELS`) | `constants.ts`, `openai-conversion.ts` |
| Responses API (`/responses`) instead of OpenAI chat.completions | GPT 5.6, Grok, Muse Spark 1.2 + Contributor Free (`routeKind: "responses"`) | `api.ts` |
| Anthropic Messages API instead of OpenAI format | Anthropic-format models (`apiFormat: "anthropic"`: every Claude entry, and the Qwen3.x Plus/Flash family) | `anthropic-conversion.ts`, `streaming/anthropic.ts` |
| `fixedTemperature: 1` sent on every request | Kimi | `model-catalog.ts` |
| System prompt sanitization and provider identity guidance | Model-specific (`guidance.ts`) | `guidance.ts` |
| Tool-use grounding guidance injected into the system prompt | All models, when tools are present | `guidance.ts` |
| Text-embedded tool call parsing (`<\|tool_call_begin\|>`, XML `<tool_calls>`) | All models (streaming) | `tool-parser.ts` |
| Tool call dedup and argument repair from chat context | All models | `tool-repair.ts` |
| `max_completion_tokens` sent instead of `max_tokens` | Thinking models (`REASONING_CONTENT_WORKAROUND_MODELS`) | `streaming/openai.ts` |
| Retry reasoning effort step-down (xhigh → high → medium → low) | Thinking models, on retry | `streaming/openai.ts` |
| Vision fallback: separate image analysis or model switch for image input | Models without native vision | `provider.ts`, `mcp.ts`, `tools.ts` |

When adding a new model, check this matrix first and prefer registering quirks in the listed location over inventing a new mechanism.

## Capability Matrix

### Thinking (Reasoning Effort)

Models with `supportsThinking: true` show a **Thinking Effort** dropdown in the model picker. This controls the `reasoning_effort` parameter, allowing users to trade reasoning depth for speed:

- `xhigh` — Maximum reasoning
- `high` — Strong reasoning
- `medium` — Balanced (default)
- `low` — Reduced reasoning

All models in the current lineup support thinking. For Anthropic-format models, the effort maps to a `thinking.budget_tokens` ratio instead.

### Vision

Models with `supportsVision: true` natively accept image input via `image_url` content parts.

For non-vision models, the `opencode_zen_analyze_image` language model tool provides vision capabilities through a separate API call. When a user attaches an image to a chat with a non-vision model, the extension:
1. Detects the image input
2. Calls the vision API separately (via `ZenMcpClient`)
3. Injects the text description into the conversation

### Tools (Function Calling)

All models except those in `NO_TOOL_MODEL_IDS` (Big Pickle, Nemotron 3.5 Lightning Free) support tool/function calling. The extension:
- Parses tool calls from streaming text output (`tool-parser.ts`)
- Deduplicates repeated tool calls (`tool-repair.ts`)
- Repairs missing/invalid arguments using `inputSchema` and chat context
- Supports both text-embedded (`<|tool_call_begin|>`) and XML-style (`<tool_calls>`) tool call formats

## Context Window Management

Each model's `contextWindow` is used to:

1. **Calculate max input tokens**: `contextWindow - maxOutput` (thinking models use a fixed minimum output budget floor of 16,384).
2. **Apply safety margin**: Dynamic margin = `max(2048, min(8192, floor(contextWindow * 0.01)))`.
3. **Cap tool results**: `calculateMaxToolResultChars()` returns a range based on context window size.

## Adding Models

Most of the time you do not edit the catalog by hand — run `bun run sync:pi:write`. It retires
the ids Zen dropped, appends the ones it added, and regenerates the table above. Metadata comes
from Pi's `opencode` provider data, falling back to models.dev for a model Pi has not picked up
yet (see `scripts/sync-from-pi.ts`). A model neither source describes is reported and left out,
so add it by hand:

1. Choose the correct `routeKind` (`responses` / `messages` / `chat_completions` / `model_specific`).
   Pick `responses` when the model is served by the OpenAI client in Responses mode — the body
   differs from `/chat/completions`, so a wrong guess fails every request.
2. Choose the `apiFormat` (`openai` / `anthropic`).
3. Set `contextWindow` and `maxOutput` from the model's spec sheet.
4. Set `supportsTools`, `supportsVision`, `supportsThinking` from the model's capabilities.
5. If the model emits `reasoning_content` in its stream (Kimi K2.6+ / DeepSeek V4+ style), add it to the `REASONING_CONTENT_WORKAROUND_MODELS` static set or rely on the dynamic prefix detection.
6. If the model is free and does not support tools, add it to `NO_TOOL_MODEL_IDS`.
7. Run `bun run sync:pi` — it fails if the catalog and the Zen model list disagree in either direction.
8. Update `tests/model-catalog.test.ts` to cover the new model.
