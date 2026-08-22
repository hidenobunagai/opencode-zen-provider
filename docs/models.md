# Supported Models

The extension bundles a static `ZEN_MODEL_CATALOG` in `src/model-catalog.ts` that mirrors the models served by the OpenCode Zen API (`https://opencode.ai/zen/v1`). Each model entry specifies its route kind (`responses` / `messages` / `chat_completions` / `model_specific`), API format (`openai` / `anthropic`), context window, max output, vision/tool/thinking support, and any fixed temperature.

Catalog last synced with the API on 2026-08-22.

## Model List

### DeepSeek Series

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| DeepSeek V4 Pro | 262,144 | 65,536 | ✗ | ✓ | ✓ | OpenAI |
| DeepSeek V4 Flash | 262,144 | 65,536 | ✗ | ✓ | ✓ | OpenAI |
| DeepSeek V4 Flash Free | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |

> **Note**: DeepSeek V4+ models require `REASONING_CONTENT_WORKAROUND_MODELS` for correct streaming output. System prompts are sanitized to replace "Claude"/"Anthropic" references.

### Gemini Series (Google)

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| Gemini 3 Flash | 1,048,576 | 65,536 | ✓ | ✓ | ✓ | OpenAI |
| Gemini 3.5 Flash Lite | 1,048,576 | 65,536 | ✓ | ✓ | ✓ | OpenAI |
| Gemini 3.6 Flash | 1,048,576 | 65,536 | ✓ | ✓ | ✓ | OpenAI |
| Gemini 3.7 Flash | 1,048,576 | 65,536 | ✓ | ✓ | ✓ | OpenAI |

> **Note**: Gemini models use a model-specific route (`/models/{id}`).

### GLM Series (Zhipu AI)

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| GLM-5.2 | 202,752 | 131,072 | ✗ | ✓ | ✓ | OpenAI |

### GPT Series (OpenAI)

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| GPT 5.6 Luna | 400,000 | 128,000 | ✓ | ✓ | ✓ | Responses |
| GPT 5.6 Sol | 400,000 | 128,000 | ✓ | ✓ | ✓ | Responses |
| GPT 5.6 Terra | 400,000 | 128,000 | ✓ | ✓ | ✓ | Responses |

> **Note**: GPT models use the **Responses API** route (`/responses`). GPT 5.6 models have a 400K context window and are treated as thinking models (`THINKING_MODELS`) for output budget purposes.

### Grok Series (xAI)

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| Grok Build 0.1 | 131,072 | 65,536 | ✗ | ✓ | ✓ | Responses |
| Grok 4.5 | 500,000 | 65,536 | ✓ | ✓ | ✓ | Responses |
| Grok 4.6 | 500,000 | 65,536 | ✓ | ✓ | ✓ | Responses |

> **Note**: Grok models use the **Responses API** route (`/responses`). They internally reason, so they are treated as thinking models (`THINKING_MODELS`) for output budget purposes.

### Kimi Series (Moonshot AI)

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| Kimi K3 | 1,000,000 | 262,144 | ✓ | ✓ | ✓ | OpenAI |

> **Note**: Kimi models use `fixedTemperature: 1` for optimal performance and require `REASONING_CONTENT_WORKAROUND_MODELS` (all Kimi except K2.5) for correct streaming output.

### Free Models

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| Big Pickle | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |
| Hy3 Free | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |
| Laguna S 2.1 Free | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |
| MiMo V2.5 Free | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |
| Nemotron 3 Ultra Free | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |
| Nemotron 3.5 Lightning Free | 262,144 | 65,536 | ✗ | ✗ | ✓ | OpenAI |

> **Note**: These free models do not support tool/function calling. They still declare `toolCalling` capability so they appear in the model picker, but the provider strips tools from requests before sending to the API (`NO_TOOL_MODEL_IDS`). The free-tier additions below DO support tools/vision despite their `-free` suffix.

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| Muse Spark 1.2 Contributor Free | 1,048,576 | 131,072 | ✓ | ✓ | ✓ | Responses |
| X Preview F Free | 262,144* | 65,536* | ✓ | ✓ | ✓ | OpenAI |

> **Muse Spark 1.2 Contributor Free**: contributor variant — request data may be used by upstream for model training. Uses the Responses API like Muse Spark 1.2.
>
> **X Preview F Free**: unnamed preview model; capabilities verified live (tools / vision / `reasoning_content` streaming) but context figures are family defaults (*), pending an official spec sheet.

### MiniMax Series

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| MiniMax M3 | 196,608 | 131,072 | ✗ | ✓ | ✓ | OpenAI |

### Muse Series

| Model | Context | Max Output | Vision | Tools | Thinking | API |
|-------|---------|------------|--------|-------|----------|-----|
| Muse Spark 1.2 | 1,048,576 | 131,072 | ✓ | ✓ | ✓ | Responses |

> **Note**: Muse Spark 1.2 uses the **Responses API** route (`/responses`) and is treated as a thinking model (`THINKING_MODELS`) for output budget purposes.

## Removed from the API (2026-08-22)

The following previously listed models now return "Model is disabled" and were dropped from the catalog: all Claude models (Fable 5, Haiku 4.5, Sonnet 4/4.5/4.6/5, Opus 4.5–4.8/5), Gemini 3.1 Pro / 3.5 Flash, GPT 5 / 5.1 series / 5.2 series / 5.3 Codex / Spark / 5.4 series / 5.5 / 5.5 Pro, GLM 5 / 5.1, Kimi K2.5 / K2.6 / K2.7 Code, MiniMax M2.5 / M2.7, Qwen3.5 Plus / Qwen3.6 Plus. The Anthropic Messages conversion path is retained in the codebase for when Anthropic-format models return to the lineup.

## Model Quirks & Workarounds

The extension applies several model-behavior workarounds while streaming. This matrix summarizes which workaround applies to which model family, and where it lives:

| Workaround | Applies to | Where |
|------------|-----------|-------|
| `reasoning_content` field added to assistant history, and parsed from streaming deltas | Kimi (except K2.5), DeepSeek V4+, X Preview F Free (`REASONING_CONTENT_WORKAROUND_MODELS`) | `constants.ts`, `openai-conversion.ts` |
| Responses API (`/responses`) instead of OpenAI chat.completions | GPT 5.6, Grok, Muse Spark 1.2 + Contributor Free (`routeKind: "responses"`) | `api.ts` |
| Anthropic Messages API instead of OpenAI format | Anthropic-format models (`apiFormat: "anthropic"`, none currently live) | `anthropic-conversion.ts`, `streaming/anthropic.ts` |
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

All models except the tool-less free models (Big Pickle, Hy3 Free, Laguna S 2.1 Free, MiMo V2.5 Free, Nemotron 3 Ultra Free, Nemotron 3.5 Lightning Free, DeepSeek V4 Flash Free) support tool/function calling. The extension:
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

To add a new model, add an entry to `ZEN_MODEL_CATALOG` in `src/model-catalog.ts`:

1. Choose the correct `routeKind` (`responses` / `messages` / `chat_completions` / `model_specific`).
2. Choose the `apiFormat` (`openai` / `anthropic`).
3. Set `contextWindow` and `maxOutput` from the model's spec sheet.
4. Set `supportsTools`, `supportsVision`, `supportsThinking` from the model's capabilities.
5. If the model emits `reasoning_content` in its stream (Kimi K2.6+ / DeepSeek V4+ style), add it to the `REASONING_CONTENT_WORKAROUND_MODELS` static set or rely on the dynamic prefix detection.
6. If the model is free and does not support tools, add it to `NO_TOOL_MODEL_IDS`.
7. Update `tests/model-catalog.test.ts` to cover the new model.
