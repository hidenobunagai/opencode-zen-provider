# Change Log
## [0.1.53] - 2026-09-17

### Fixed

- **`bun run sync:pi --check` now reaches a docs row the docs spell differently, and reports an entry no row matches at all.** `docsRowCandidates` built the docs lookup from the id (`glm-5.2` → `Glm 5.2`) and from the catalog `name`, and both were matched literally, so the row the docs write `| GLM-5.2 |` was never reached: 21 of 22 entries were compared. A dash and a space are the same separator in a model name now, so either spelling finds the row — `syncDocs` reaches it today only because Pi's name is `GLM-5.2`, and the moment Pi drops the model the row would keep values nothing checks, the same silent skip that let `x-preview-f-free` drift. An entry *no* row matches is now reported too (the one state where even `syncDocs` has nothing to compare against) instead of `continue`-ing past it. Verified against the live sources: 22/22 entries reached, no standing warnings, `bun run sync:pi` exits 0 (`c12696c`).

### Removed

- **Retired the three models Zen no longer serves.** `bun run sync:pi` reported `hy3-free`, `laguna-s-2.1-free` and `x-preview-f-free` as absent from Pi *and* missing from Zen's live model list, so their picker entries could only fail at request time. All three are dropped from `ZEN_MODEL_CATALOG` and from the two id-keyed sets that may only name live entries (`NO_TOOL_MODEL_IDS`, `REASONING_CONTENT_WORKAROUND_STATIC_SET`) — the catalog gate fails when a retired id stays behind in them. `docs/models.md` loses the three table rows plus their mentions in the tool-less list, the `reasoning_content` workaround row and the preview-model note, and gains a line under "Removed from the API"; `README.md` and `tests/model-catalog.test.ts` follow. `deepseek-v4-flash-free` stays: Zen still serves it, Pi's data just lags. The retirement also clears the docs/catalog disagreement the gate reported for `x-preview-f-free` (context 1,000,000 vs 262,144, max output 131,072 vs 65,536) (`f0b4146`).

## [0.1.52] - 2026-09-16

### Fixed

- **`bun run sync:pi` now reports a catalog entry whose block its regex cannot reach instead of skipping it in silence.** `syncCatalog` tested the id regex first and `continue`d when the block regex found no match, so an entry written in a shape the regex does not accept (e.g. `{ /* zen: probed 2026-09-14 */` before `id:`) was never compared — the same path that left a `//`-commented block unverified until `48688c3` in 0.1.51. The id is now reported as a diff, so `--check` exits 1 and CI's `bun run sync:pi` step stops while the entry keeps values nothing can verify. `--write` cannot reach such a block either, so it lists the same line and applies nothing. Verified against the current catalog: 21 of Pi's 68 ids match it and all 21 blocks are reachable, so this adds no standing diff, and injecting a `/* */` comment before one id makes a scratch copy of the CLI exit 1 with the new line (`0aedad2`).

### Changed

- **`sync:pi` records why models.dev is not a third source.** The backlog asked whether `https://models.dev/api.json` (provider `opencode`) should join the warn-only blocks as a third source for the catalog entries Pi does not carry. Measured 2026-09-15, it should not, and the reason now lives in the `scripts/sync-from-pi.ts` header: it disagrees with the catalog on 8 of 25 entries, and 5 of those (Gemini 3.x, grok-build-0.1: `reasoning: true` while the catalog and docs say Thinking ✗) are entries the two existing sources already agree on — the flag means internal reasoning, not the levels Zen exposes. For the 4 entries Pi cannot check it would add 6 lines and arbitrate none of them: `limit.context` / `limit.output` disagree with both the catalog and docs for `deepseek-v4-flash-free` (200,000 / 128,000; Zen still serves it) and `laguna-s-2.1-free`, and side with docs only for `x-preview-f-free`, which `catalogDocsDiffs` already reports. The warning blocks themselves are untouched (`fea3580`).
- **Dropped the dead `ZenModelInfo.needsReasoningContentWorkaround` field.** It had no reader — only the declaration (`model-catalog.ts:27`) and its one `kimi-k3` assignment (`:275`), with `tests/` and `scripts/` never mentioning it. The workaround is decided by `REASONING_CONTENT_WORKAROUND_MODELS.has(modelId)` in `constants.ts`, which all three read sites use (`streaming/openai.ts:121`, `streaming/anthropic.ts:107`, `openai-conversion.ts:283`), and the latter two take a bare `modelId`, so the catalog flag could not be consulted without threading the whole entry through. Keeping it was the trap: setting the field read as "this enables the workaround" but did nothing. Deleting it and its assignment changes no behavior — `kimi-k3` still matches the `kimi-` prefix and is not `k2.5`, and `x-preview-f-free` only works through `REASONING_CONTENT_WORKAROUND_STATIC_SET` (`f904463`).

## [0.1.51] - 2026-09-15

### Fixed

- **Reasoning models no longer get the "produced no visible response" notice appended to a real answer.** The notice was gated on `!pendingText`, but `flushPendingText()` a few lines above had already cleared that buffer, so any model that emitted `reasoning_content` and then normal text (deepseek-v4-\*, kimi-\*, x-preview-f-free) had "The model completed internal reasoning but produced no visible response…" glued onto its reply. The stream now tracks `emittedVisibleText` and gates the notice on text that was actually reported. No test reached the notice before, so the regression rode along unnoticed (`76af491`); the direct `processOpenAIStream` suite added with it covers the path (`c3ea8a2`).
- **The reasoning cache now restores the previous turn's reasoning.** `reasoningCache.set()` was keyed on `pendingText` after the flush three lines above cleared it, so the `pendingText.trim().length > 0` guard could never hold and nothing was ever cached; the next turn's assistant history fell back to a single space. The cache is keyed on the trimmed concatenation of the chunks that were actually reported — exactly what `convertMessages` looks up (`4a107e4`).
- **Tool calls whose arguments are not valid JSON are now reported instead of dropped in silence.** A buffered call with balanced braces but invalid JSON (the single-quoted `{'filePath':'a.ts'}` a model sometimes writes) failed `JSON.parse` mid-stream and again in the end-of-stream flush, and both `catch` blocks discarded the error: `skippedToolCalls` stayed empty, `buildInvalidToolCallFallback` returned undefined, and the turn ended after all three attempts with no `progress.report` at all. The failure is now recorded as a malformed skipped call, and the fallback says the arguments were not valid JSON rather than claiming required ones are missing — no argument name can be read out of broken JSON (`1243230`).
- **`tsconfig.scripts.json` is no longer shipped inside the VSIX.** `.vscodeignore` listed only `tsconfig.json`, so every package built since the scripts type-check landed carried `extension/tsconfig.scripts.json` — confirmed in the existing `opencode-zen-provider-0.1.50.vsix`. `vsce ls` drops from 27 files to 26, and nothing at runtime reads the file (`package.json` `main` is `./out/extension.js`) (`7da21e3`).
- **`bun run sync:pi` now reaches catalog entries whose block opens with a `//` comment.** `syncCatalog`'s block regex required `id:` directly after `{`, so a commented block was skipped in silence while the id regex still matched the file. `muse-spark-1.2-contributor-free` kept `supportsThinking: true` with no `supportedReasoningEfforts`, leaving `provider.ts` on the low/medium/high/max fallback — a set that includes `max`, which Pi maps to null for that model. It now gets the five levels Pi reports, matching its non-contributor sibling and its docs row (`48688c3`).

### Added

- **`bun run sync:pi --check` lists catalog entries Pi cannot verify, and asks the live Zen list which of them Zen still serves.** An entry whose id is missing from Pi's data was never compared at all — context window, vision, thinking and its docs row went unchecked — so a model Zen dropped stayed in the picker. The check separates Pi lag (`deepseek-v4-flash-free`, still served) from dead entries (`hy3-free`, `laguna-s-2.1-free`, `x-preview-f-free`). Warn-only: retiring a model is a product decision, and an unreadable Zen list degrades to ids only and still exits 0, so CI cannot flake on network (`338b4d0`).
- **`bun run sync:pi --check` also compares each catalog entry with its own `docs/models.md` row.** The id check cannot see a docs row that keeps values the catalog no longer states, because the Zen list returns ids alone; `--check` now reports the disagreeing cells (e.g. `x-preview-f-free`: docs 1,000,000 / 131,072 / `low,high,max` vs catalog 262,144 / 65,536 / no levels). Warn-only, since Zen cannot say which side is stale (`26f0767`).
- **Tests reach every streaming module directly.** `src/streaming/anthropic.ts` (49.75% lines / 30.46% branches) and its 1:1 sibling `src/streaming/openai.ts` (72.77% / 53.89%) had been reachable only through `provider.test.ts`, leaving the request builders, retry loops and tool-call state machines uncovered. Both are now driven end to end from mocked transports and SSE bodies (`0ff1ea7`, `c3ea8a2`); the suite grows 208 → 248 tests and the two modules sit at 99.51% and 100% lines. `streaming-vcr.test.ts` was renamed to `streaming-api.test.ts`, which is what it drives.
- **Retired ids can no longer linger in the id-keyed side sets.** `NO_TOOL_MODEL_IDS`, `REASONING_CONTENT_WORKAROUND_STATIC_SET` and `THINKING_MODEL_STATIC_SET` are keyed by id but never read `ZEN_MODEL_CATALOG`, so deleting a catalog entry left its id behind with no gate to fail. One assertion now requires every id in all three sets to name a catalog entry (`9b660a7`). A structural assertion likewise pins `supportedReasoningEfforts` behind `supportsThinking`, which neither `provider.ts` nor `sync:pi` would have caught (`adccf00`).

### Changed

- **CI installs with `bun install --frozen-lockfile`.** CI ran the plain install while Publish already froze the lockfile, so a `package.json` / `bun.lock` drift re-resolved from `package.json` and still exited 0: CI went green and only the tag-triggered Publish run failed, or a VSIX shipped from a dependency set no committed file records. The committed lock already satisfies `package.json`, so the flag changes nothing but the gate (`1c31d1f`).
- **Jest now sees untested `src` modules.** `roots` was `["<rootDir>/tests"]`, and `CoverageReporter._addUntestedFiles` walks the haste map that `roots` scopes, so `collectCoverageFrom: ["src/**/*.ts"]` only ever listed files a test had already imported: a new, unimported module stayed out of both the file list and the totals instead of showing up at 0%. Adding `src` to `roots` makes such a module drag the gate down, while the totals keep their headroom (`d219e94`); the gate comments now quote the measured figures for the current suite (`b3976f7`, `971fb8c`, `2f1665d`).
- **Dropped the unreachable "all retries failed" tail in both streaming retry loops.** Every iteration returns, continues or throws, and every `continue` requires `attempt + 1 < maxRetries`, so the last attempt always leaves through its own `return` or `throw`; the trailing `throw lastError ?? …` could never run and `lastError` existed only to feed it. New tests pin the rethrown error per sibling so a later edit cannot turn exhausted retries into success (`1c2d4a3`).

## [0.1.50] - 2026-09-13

### Changed

- **CI and Publish now use Node.js 24 actions, clearing the Node.js 20 deprecation annotation.** Every run carried `Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: actions/checkout@v4, actions/upload-artifact@v4` (run 34723067973, and `actions/checkout@v4` alone on Publish runs such as 34710144255). Measured per action with `gh api repos/<owner>/<repo>/contents/action.yml`: `runs.using` is `node20` for `actions/checkout` v4 and `actions/upload-artifact` v4/v5, and `node24` for `actions/checkout` v5-v7 and `actions/upload-artifact` v6/v7. `ci.yml` now pins `actions/checkout@v7` / `actions/upload-artifact@v7` and `publish.yml` pins `actions/checkout@v7`; `oven-sh/setup-bun@v2` already declares `node24` and `google/osv-scanner-action` is not a JavaScript action, so no annotation source remains. The `allow-unsafe-pr-checkout` breaking change backported to checkout v5+ only affects `pull_request_target` / `workflow_run` checkouts, which neither workflow uses.

## [0.1.49] - 2026-09-12

### Changed

- **`check-changelog` now validates the whole version history, not just the current version.** It previously only checked that `package.json`'s version had a `## [X.Y.Z]` heading somewhere in `CHANGELOG.md`, so two sections claiming the same version — what a rebase produces when both sides bump to the same number, as happened with `0.1.43` — passed every gate and shipped. The script now collects every `^## \[(\d+\.\d+\.\d+)\]` heading and fails on duplicate versions and on sections that are not in descending order by version and by date (equal dates are allowed, since several versions can share a release day, and missing intermediate versions stay allowed), so this class of accident stops at `bun run package:vsix`.

## [0.1.48] - 2026-09-12

### Fixed

- **Duplicate `## [0.1.43]` sections in `CHANGELOG.md` merged into a single entry.** Two commits that were rebased onto the same line both claimed version 0.1.43: the Zen catalog sync (2026-08-15) and the provider/tool-repair formatting fix plus legacy tiktoken test replacement (2026-08-29). `package.json` went 0.1.42 → 0.1.43 in the earlier-committed of the two (`abd6454`), so the later commit's "Bump version to 0.1.43" was a no-op and `package.json` stayed 0.1.43 until the 0.1.44 bump (`b7ce569`). Both sets of changes shipped in the 0.1.43 line, so they are now documented in one section; the merged section keeps the 2026-08-15 date because 0.1.43 precedes 0.1.44 (2026-08-22) and this file lists versions and dates in descending order.

## [0.1.47] - 2026-09-12

### Changed

- **README publishing notes now match the publish workflow: releases go to the VS Code Marketplace *and* Open VSX.** The README claimed the extension is published "**only** to the VS Code Marketplace — do not publish it to Open VSX" (written 2026-08-15), but `.github/workflows/publish.yml` (2026-08-30) publishes the same VSIX to both registries via `VSCE_PAT` / `OVSX_PAT`, and 0.1.45 / 0.1.46 are live on Open VSX. The workflow is the deliberate, newer decision and is left unchanged; only the stale documentation was corrected.

## [0.1.46] - 2026-09-12

### Fixed

- **VSIX packaging no longer picks up the local `.commandcode/` directory.** `.commandcode/**` was missing from the agent-config exclusion list in `.vscodeignore`, so locally built VSIX packages contained `extension/.commandcode/taste/taste.md` (confirmed in the 0.1.45 artifact). The directory is untracked and synced from the Mac, so CI-built packages were unaffected — only local artifacts were polluted.

## [0.1.45] - 2026-09-12

### Fixed

- **`bun run package:vsix` no longer fails with `npm error code ELSPROBLEMS`.** `vsce` detected dependencies with `npm list --production`, which reported leftover packages in `node_modules` (e.g. `uuid`, `@isaacs/cliui`, `jackspeak` from the 2026-08-30 dependency set) as extraneous and aborted packaging. This extension has no runtime dependencies and `.vscodeignore` already excludes `node_modules/**`, so packaging now passes `--no-dependencies` and produces the identical VSIX regardless of the state of the local `node_modules` — matching CI, which installs cleanly with `bun install --ignore-scripts`.

## [0.1.44] - 2026-08-22

### Added

- **New models from the Zen API**: Muse Spark 1.2 Contributor Free (Responses API route, contributor variant — request data may be used for upstream model training) and X Preview F Free (unnamed preview model; tools / vision / reasoning verified live).
- **X Preview F Free added to `REASONING_CONTENT_WORKAROUND_MODELS`** (emits `reasoning_content`) and **Muse Spark 1.2 Contributor Free added to `THINKING_MODELS`**.

### Fixed

- **Smoke test script now reads `ZEN_MODEL_CATALOG` directly** instead of maintaining a duplicate hardcoded list, and sends correct Responses API payloads (`input` / `max_output_tokens`) so all live models can be verified.
- **VSIX packaging**: excluded agent-config files/directories (`.claude/`, `.gemini/`, `.codebuddy/`, `.kiro/`, `.qoder/`, `GEMINI.md`, etc.) and the local `.bun-cache/` (815 files / 15.6 MB) from the package; the VSIX is now ~70 KB with 28 files instead of hundreds of files.

### Removed

- **Removed 39 models now disabled on the Zen API** (verified via live probes returning "Model is disabled"): all Claude models (Fable 5, Haiku 4.5, Sonnet 4/4.5/4.6/5, Opus 4.5–4.8/5), Gemini 3.1 Pro / 3.5 Flash, GPT 5 / 5.1 series / 5.2 series / 5.3 Codex / Spark / 5.4 series / 5.5 / 5.5 Pro, GLM 5 / 5.1, Kimi K2.5 / K2.6 / K2.7 Code, MiniMax M2.5 / M2.7, Qwen3.5 Plus / Qwen3.6 Plus. The Anthropic Messages conversion path is retained in the codebase for when Anthropic-format models return.

## [0.1.43] - 2026-08-15

### Added

- **New models from the Zen API**: Gemini 3.7 Flash, Grok 4.6, Muse Spark 1.2, Hy3 Free, Nemotron 3.5 Lightning Free.
- **Grok 4.5 / Grok Build 0.1 moved to the Responses API route** and **Qwen3.6 Plus moved to the Anthropic Messages API** to match the current Zen API endpoints (`/responses` and `/messages` respectively).
- **Grok 4.5 / 4.6 and Muse Spark 1.2 are treated as thinking models** (`THINKING_MODELS`) for output budget purposes, matching the existing GPT 5.6 handling.

### Fixed

- **Formatting in provider.ts and tool-repair.ts.** Removed incorrectly formatted multi-line union type expressions that were introduced by a prior formatting pass.

### Changed

- **Replaced legacy tiktoken fallback test.** `utils-tiktoken-fallback.test.ts` attempted to mock `@dqbd/tiktoken`, which is no longer used (the extension now uses pure character-based estimation). Replaced with `utils-tokenizer.test.ts` that directly tests the current tokenizer implementation.

### Removed

- **Removed models no longer served by the Zen API**: Claude Opus 4.1 (deprecated 2026-08-05), Ling 3.0 Flash Free, North Mini Code Free.

## [0.1.42] - 2026-08-02

### Added

- **New models from the Zen API**: Claude Opus 5, Claude Sonnet 5, Gemini 3.6 Flash, Gemini 3.5 Flash Lite, GPT 5.6 Luna / Sol / Terra, Grok 4.5, Kimi K2.7 Code, Kimi K3, MiniMax M3, Ling 3.0 Flash Free, Laguna S 2.1 Free.
- **Removed deprecated models** no longer served by the Zen API: Qwen3.7 Max, Qwen3.7 Plus, Qwen3.6 Plus Free, MiniMax M3 Free, Nemotron 3 Super Free.
- **Dynamic reasoning-content workaround detection.** `REASONING_CONTENT_WORKAROUND_MODELS` now detects workaround-required models by ID pattern (all Kimi except K2.5, DeepSeek V4+) instead of a single hardcoded `kimi-k2.6` entry, so newly released reasoning models work correctly out of the box.
- **CJK-aware token estimation.** Japanese/Chinese/Korean and full-width characters are now counted as ~1 token each instead of the Latin ratio of 2 chars/token, preventing over-limit requests from slipping through for CJK-heavy conversations.
- **`max_completion_tokens` for thinking models.** OpenAI-format thinking models (Kimi, DeepSeek V4+) now receive `max_completion_tokens` (min 16K, capped at the model's declared max output) instead of `max_tokens`, so internal reasoning no longer eats the visible output budget. Retries step the reasoning effort down (xhigh → high → medium → low) and double the output budget when the model only reasoned without producing visible output.
- **Action announcement nudge.** When a model ends its turn by announcing an action ("テストを実行します。" / "I will run the tests.") without emitting the tool call, the extension silently replays the announcement and nudges the model to emit the announced tool call, keeping agentic loops from silently ending early.
- **Reasoning content history restoration.** Assistant message text is stripped of embedded reasoning blocks (HTML `<details data-reasoning>` / Markdown blockquote) and the reasoning content is cached in a bounded 50-entry LRU so follow-up turns send `reasoning_content` correctly for workaround models.
- **docs/models.md** documenting the full model catalog, capabilities, quirks, and how to add models.
- **`check-changelog` script** verifying package.json version matches CHANGELOG.md before packaging.

## [0.1.41] - 2026-06-27

### Added

- **Thinking Effort dropdown is now available for ALL models.** Previously only 6 reasoning models showed the Thinking Effort option. Now every model in the catalog (GPT, Claude, Gemini, GLM, DeepSeek, Kimi, Qwen, Grok, MiniMax, free models, etc.) has `supportsThinking` enabled.
- **Anthropic extended thinking support.** Claude models and other Anthropic-format models (qwen3.5-plus, qwen3.7-max, qwen3.7-plus) now pass the `thinking` parameter with a proportional `budget_tokens` when Thinking Effort is set (low=20%, medium=40%, high=60%, xhigh=80% of max_tokens).

## [0.1.40] - 2026-06-27

### Added

- **Added Thinking Effort dropdown for reasoning models.** GLM-5, GLM-5.1, GLM-5.2, DeepSeek V4 Pro, DeepSeek V4 Flash, Kimi K2.5, Kimi K2.6, and Qwen3.6 Plus now show a "Thinking Effort" dropdown (Default / Max / High / Medium / Low) in the model picker via `configurationSchema`. The selected effort is sent as `reasoning_effort` in the API request.

## [0.1.37] - 2026-05-01

### Fixed

- Restored `max_tokens` for reasoning/thinking models using the full declared `maxOutput` budget (e.g. 262144 for Kimi K2.6) instead of the 65536 default cap. The v0.1.36 approach of omitting `max_tokens` entirely caused reasoning models to consume their entire output budget on internal thinking, leaving zero visible text in the response.
- Added a user-visible fallback message when a reasoning model produces internal thinking but no visible output.

## [0.1.36] - 2026-04-30

### Fixed

- Stopped sending `max_tokens` to reasoning/thinking models (`kimi-k2.6`) — the API self-regulates output budget and an explicit cap causes premature mid-response stops.
- Added streaming retry loop (3 attempts) with mid-response stop detection and snapshot-based tool call deduplication to recover from transient generation failures.
- Skipped retry loop for reasoning models — retrying is pointless when `max_tokens` is omitted and the model self-regulates output.

### Performance

- Cached tiktoken encoding object across all `estimateTokens()` calls instead of creating/freeing one per invocation.
- Compressed provider identity guidance from 6 lines to 1 line and tool-use grounding guidance from 12 rules to 4 rules, reducing system prompt token overhead.
- Reduced context window safety margin from 3% to 1% (min 2048 → was 1024), freeing more usable context headroom.

### Added

- Reasoning model minimum output budget constant (16384 tokens) for context window calculations, ensuring thinking models have guaranteed output headroom.

## [0.1.35] - 2026-04-30

### Performance

- Pre-compiled 4 regex patterns at module level in `tool-repair.ts` with early-exit booleans to skip redundant context extraction.
- Added balanced-braces preflight check before JSON.parse in OpenAI streaming tool call assembly, eliminating parse exceptions on incomplete arguments.
- Replaced per-character regex whitespace skip in `tool-parser.ts` with single `slice().match(/^\s*/)`.
- Replaced 9 separate `indexOf()` token searches in `tool-parser.ts` with a single pre-compiled regex pass (`RE_START_TOKENS`).
- Pre-compiled regex patterns (`RE_BASE64`, `RE_CONTROL_CHARS`) and reused `TextDecoder` singleton in `message-parts.ts`.
- Added WeakMap-based canonical tool call key cache in `tool-repair.ts` to avoid repeated `JSON.stringify` during deduplication.
- Skipped tiktoken for CJK-prefixed models (kimi, qwen, glm, hy3, ling) — char-based fallback is more accurate and faster.

### Added

- Image token estimation (1000 tokens/image) in `estimateMessagesTokens()` for more accurate context window accounting.
- SSE streaming 60-second timeout with `clearTimeout` cleanup to prevent indefinite hangs when the server stops sending data.
- Identity and tool-use grounding guidance now applied to ALL models, not just DeepSeek.
- Schema-enriched tool descriptions also applied to Anthropic API format.

## [0.1.34] - 2026-04-29

### Changed

- Improved token estimation for CJK-optimized models (kimi, qwen, glm, hy3, ling) by using a more conservative character-based fallback ratio (0.8 instead of 2.0), reducing 3x underestimation of Chinese text tokens.
- Replaced the fixed 4096-token context window safety margin with a percentage-based calculation (3% of context window, min 1024, max 8192), giving small models more usable context and large models sufficient buffer.
- Pre-compiled 15 regex patterns at module level in `tool-parser.ts` to eliminate per-chunk recompilation overhead during SSE streaming.
- Moved the reasoning_content workaround flag into the model catalog (`needsReasoningContentWorkaround`) instead of a separate Set, making per-model configuration more discoverable and maintainable.

### Added

- VCR-style streaming tests (`tests/streaming-vcr.test.ts`): 13 tests covering Anthropic SSE event parsing, OpenAI tool call delta chunking, and all pseudo tool-call formats (JSON-fenced, compact XML, tool_sep, legacy tokens).
- Smoke test script (`scripts/smoke.ts`): `bun run smoke` verifies all Zen models respond correctly. Filter with `--model <id>` and enable verbose output with `--verbose`.

### Removed

- Deleted 10 stale `.vsix` build artifacts from the repository root (already covered by `.gitignore`).

## [0.1.33] - 2026-04-28

### Fixed

- Parsed no-tool-model pseudo tool calls that encode arguments with `tool_sep`, `arg_key`, and `arg_value` markers instead of JSON or XML attributes.
- Recovered multiple `read_file` calls from a single `<tool_calls>` wrapper even when some argument value tags are malformed, preventing raw pseudo-tool blocks from leaking into chat.

## [0.1.32] - 2026-04-28

### Fixed

- Repaired malformed `runSubagent` outputs that omit `agentName` by inferring the intended subagent from the assistant's surrounding text.
- Restored `Explore` subagent invocations for no-tool-model workspace summary requests that were otherwise falling back to a generic subagent run.

## [0.1.31] - 2026-04-28

### Fixed

- Repaired malformed `runSubagent` outputs that omit `prompt` by falling back to the latest user request extracted from chat context.
- Stopped surfacing the invalid-tool fallback message for no-tool-model subagent requests when the task text can be recovered from the current chat turn.

## [0.1.30] - 2026-04-28

### Fixed

- Parsed fenced JSON pseudo tool calls that use legacy top-level fields like `agentName` and `argument` instead of nesting arguments under `parameters` or `args`.
- Recovered malformed no-tool-model `runSubagent` outputs that were previously rendered as a visible JSON code block in chat.

## [0.1.29] - 2026-04-28

### Fixed

- Parsed nested generic `<tool_call>` marker chains from no-tool models such as Hy3 Preview Free, so visible `<tool_calls>` wrappers no longer leak into chat transcripts for malformed `runSubagent` outputs.
- Accepted legacy `runSubagent` payloads that use `input` instead of `prompt` and repaired them into a valid subagent invocation.

## [0.1.28] - 2026-04-28

### Fixed

- Parsed malformed XML-like `runSubagent` outputs from no-tool models such as Hy3 Preview Free, including legacy `name` / `argument` / `argumentHint` fields.
- Accepted broken pseudo-XML blocks that close with the tool name instead of `</tool_call>` and still recovered the intended tool invocation.

## [0.1.27] - 2026-04-28

### Fixed

- Parsed compact XML-style pseudo tool calls such as `<tool_call>read_file path="..."</tool_call>` into real tool invocations for no-tool models like Hy3 Preview Free.
- Kept local tool schemas available for argument repair and validation even when tool definitions are stripped from upstream API requests for no-tool models.
- Stopped reusing the active editor selection range when a repaired `read_file` call explicitly targets a different file.

## [0.1.26] - 2026-04-28

### Fixed

- Restored OpenAI-stream responses when a model ends on an incomplete embedded tool block or fenced JSON snippet by flushing the unresolved tail as literal text instead of dropping the entire reply.

## [0.1.25] - 2026-04-28

### Fixed

- Parsed fenced JSON pseudo tool-call blocks into real tool invocations for no-tool models such as Hy3 Preview Free, so raw `read_file` payloads no longer leak into the chat transcript.

## [0.1.24] - 2026-04-28

### Changed

- Removed startup-time `/models` discovery and now use the bundled `FALLBACK_MODELS` list as the single source of truth for selectable models.
- Unified vision/image analysis requests with the shared chat completion request path, including retries, user-agent propagation, and explicit empty-response errors.
- Stopped fabricating placeholder tool search queries when required arguments are missing; invalid tool calls now surface the missing arguments instead.
- Split the previous monolithic `utils.ts` responsibilities into focused conversion and tokenizer modules.
- Pinned `@types/vscode` to the supported VS Code API baseline and pinned the CI Bun runtime.
- Added VSIX packaging to CI so marketplace packaging regressions are caught before release.

## [0.1.23] - 2026-04-27

### Added

- Added Medium thinking variant for DeepSeek V4 Pro and DeepSeek V4 Flash, matching the full set available in OpenCode Go CLI (Default, Low, Medium, High, Max).

## [0.1.19] - 2026-04-27

### Added

- Added thinking mode variants for DeepSeek V4 Pro and DeepSeek V4 Flash: (Max Thinking), (High Thinking), (Low Thinking).
- Thinking variants appear as separate entries in the model picker, similar to native Copilot Chat models.
- Each variant sends the `reasoning_effort` parameter to the target model.

## [0.1.16] - 2026-04-26

### Changed

- Refactored monolithic provider.ts into focused modules: tool-parser, tool-repair, guidance, streaming/openai, streaming/anthropic.
- Improved token estimation with model-aware tiktoken-based tokenizer (fallback to char-based heuristic).
- Parallelized image analysis with Promise.all for multi-image messages.

### Fixed

- Added debugLog to previously silent error catch blocks across streaming modules.
- Replaced `require()` with ES import for package.json, removed unused imports.
- Tightened TypeScript types, eliminated `no-explicit-any` warnings in source files.

## [0.1.15] - 2026-04-26

### Fixed

- Improved tool grounding for non-DeepSeek models so workspace inspections are less likely to fail on missing `read_file` arguments.
- Added stronger `read_file` argument repair and editor-context fallback handling to reduce empty tool-call crashes.

## [0.1.14] - 2026-04-26

### Fixed

- Improved Kimi / API handling of `HTTP 429 Too Many Requests` by honoring server-provided `Retry-After` headers regardless of absolute length, and increasing chat completion retry limits.
- Automatically repair `grep_search` and `file_search` arguments (`query`, `isRegexp` etc.) before dispatch to VS Code Copilot agent handlers, preventing random crashes when the model hallucinates missing required tool inputs.
- Converted residual `console.warn` usage to `debugLog` to avoid console spam in production paths.

## [0.1.13] - 2026-04-26

### Changed

- Improved DeepSeek V4 Pro / V4 Flash tool-use grounding so workspace and file summaries stay tied to actual tool outputs.
- Routed DeepSeek tool-enabled chats through the OpenAI-compatible chat completions path with explicit automatic tool choice.

### Fixed

- Preserved DeepSeek reasoning-content placeholders for tool-call history to avoid thinking-mode request failures.
- Reduced DeepSeek tool-use roleplay by reinforcing evidence-based guidance for latest-file and workspace claims.

## [0.1.12] - 2026-04-26

### Added

- Added `--json` output mode to the DeepSeek comparison helper so upstream identity checks can be saved directly as machine-readable logs.
- Added a `bun run repro:compare:json` shortcut for the default DeepSeek vs Kimi comparison pair.

## [0.1.11] - 2026-04-26

### Added

- Added side-by-side model comparison support to the DeepSeek reproduction script so the same prompt can be sent to DeepSeek and reference models in one run.

### Changed

- Added a `bun run repro:compare` helper and expanded README troubleshooting guidance for upstream model identity checks.

## [0.1.10] - 2026-04-26

### Changed

- Removed verbose DeepSeek investigation logs from the Anthropic `/messages` path after the streaming fix was validated.
- Added a `bun run repro:deepseek` helper script and README troubleshooting steps to verify directly whether OpenCode Go routes `deepseek-v4-flash` to an unexpected upstream model.

## [0.1.9] - 2026-04-26

### Fixed

- DeepSeek V4 Pro / V4 Flash: accept raw JSON event lines on the `/messages` streaming endpoint in addition to standard `data:` SSE lines. This fixes cases where the model produced a valid response but VS Code showed "Sorry, no response was returned".

## [0.1.8] - 2026-04-26

### Removed

- Removed the **Refresh Models** command (`opencode-go.refreshModels`). OpenCode Go does not provide a `/models` endpoint, so the command always failed. The built-in `FALLBACK_MODELS` list is now the sole source of model information.

## [0.1.7] - 2026-04-26

### Fixed

- DeepSeek V4 Pro / V4 Flash: use OpenAI-format tool definitions (`convertTools`) instead of Anthropic format (`convertToolsToAnthropic`) when calling the `/messages` endpoint. The DeepSeek proxy expects `tools[].function.name` rather than `tools[].name`.

## [0.1.6] - 2026-04-26

### Fixed

- Changed DeepSeek V4 Pro and V4 Flash to use Anthropic Messages API (`/zen/go/v1/messages`) instead of OpenAI format, matching the official OpenCode Go API documentation.
- Improved Refresh Models error message to clarify that OpenCode Go does not provide a models list endpoint.

## [0.1.5] - 2026-04-26

### Fixed

- Set `supportsVision: false` for DeepSeek V4 Pro and V4 Flash (these models do not accept `image_url` input).


## [0.1.2] - 2026-04-24

### Added

- Automated CI with GitHub Actions (lint → compile → test).
- ESLint + Prettier configuration with lint/format scripts.
- Comprehensive test suites for MCP client and tool registration.
- HTTP retry logic with exponential backoff and `Retry-After` header support.

### Changed

- Unified `BASE_URL` and `EXTENSION_VERSION` into `src/constants.ts`.
- Centralized debug logging into `src/output-channel.ts`.
- Pinned `@vscode/vsce` as devDependency for reproducible packaging.

### Fixed

- `fetchWithRetry` now handles HTTP 429/502/503/504 in addition to network errors.
- User-Agent version now matches `package.json` dynamically.

## [0.1.0] - 2026-04-24

### Added

- Initial release.
- Support for 12 OpenCode Go models:
  - GLM-5, GLM-5.1
  - Kimi K2.5, Kimi K2.6 (fixed temperature = 1 per provider requirements)
  - MiMo-V2-Pro, MiMo-V2-Omni, MiMo-V2.5-Pro, MiMo-V2.5
  - MiniMax M2.5, MiniMax M2.7 (via Anthropic Messages API)
  - Qwen3.5 Plus, Qwen3.6 Plus
- OpenAI-compatible streaming chat (`POST /chat/completions`) for most models.
- Anthropic Messages API streaming (`POST /messages`) for MiniMax M2.5 / M2.7.
- Tool calling (function calling) support for all models.
- Vision / image input support:
  - Native vision for Kimi K2.x, MiMo-V2-Omni, MiMo-V2.5-Pro, MiMo-V2.5, Qwen3.x.
  - Automatic routing to `mimo-v2-omni` when a non-vision model receives an image.
  - OCR text-extraction fallback via `OcGoMcpClient` when no vision model is available.
- `opencode_go_analyze_image` Language Model Tool for direct image analysis from the chat UI.
- Secure API key storage via VS Code `SecretStorage` (`opencode-go.apiKey`).
- Commands:
  - **OpenCode Go: Manage OpenCode Go API Key** — set or clear the API key.
  - **OpenCode Go: Refresh Models** — fetch the current model list from the API.
  - **OpenCode Go: Toggle Debug Logging** — write verbose request logs to the Output panel.
  - **OpenCode Go: Open Debug Log** — reveal the Output panel for the extension.
- Dynamic model list refresh on startup; falls back to the built-in `FALLBACK_MODELS` list when the API is unreachable.
- Text-embedded tool call parsing (`<|tool_call_begin|>…<|tool_call_end|>`) for models that embed tool calls in the response text.
- Tool argument repair heuristics for `read_file` and `list_dir` tools (auto-fills `filePath`, `path`, line ranges from context).
