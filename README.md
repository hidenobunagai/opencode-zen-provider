# OpenCode Zen Provider

VS Code extension project for using curated OpenCode Zen models in Copilot Chat with your own OpenCode Zen API key.

## Requirements

- VS Code 1.104.0 or later
- GitHub Copilot extension installed and active
- An OpenCode Zen API key from <https://opencode.ai/auth>

## Installation

### From Source

1. Clone this repository.
2. Run `bun install --ignore-scripts && bun run compile`.
3. Press `F5` in VS Code to launch the Extension Development Host.

### From VSIX

1. Run `bun install --ignore-scripts && bun run package:vsix`.
2. Install the generated `.vsix` file via **Install from VSIX...** in the Extensions view.

## Setup

1. Open Copilot Chat and open the model picker.
2. Add or configure **OpenCode Zen**.
3. Enter your OpenCode Zen API key when prompted.
4. If needed, run `OpenCode Zen: Manage OpenCode Zen API Key` from the Command Palette.
5. Select **OpenCode Zen** in Copilot Chat and choose a model.

## Supported Models

V1 uses a checked-in static catalog. The initial catalog includes:

- Big Pickle
- MiniMax M2.5, MiniMax M2.5 Free, MiniMax M2.7
- Claude Opus 4.7, Claude Sonnet 4.6
- GPT 5.4, GPT 5.4 Mini, GPT 5.4 Nano, GPT 5.4 Pro
- GPT 5.5, GPT 5.5 Pro
- Gemini 3 Flash, Gemini 3.1 Pro
- GLM 5.1
- Hy3 Preview Free
- Kimi K2.6
- Ling 2.6 Flash Free
- Nemotron 3 Super Free
- Qwen3.6 Plus
- Trinity Large Preview

## Current V1 Scope

- Provider registration, API key management, static model catalog, and core chat-provider wiring are included.
- The custom image-analysis tool from the Go reference project is intentionally excluded.
- Non-vision models reject image input explicitly in V1.

## Development

```bash
bun install --ignore-scripts
bun run compile
bun run lint
bun run test -- --runInBand
```

Press `F5` in VS Code to launch the Extension Development Host.

### Available Scripts

- `bun run compile` - TypeScript compile
- `bun run watch` - TypeScript watch mode
- `bun run test` - Run Jest
- `bun run lint` - Run ESLint
- `bun run lint:fix` - Auto-fix ESLint issues
- `bun run format` - Run Prettier
- `bun run package:vsix` - Build a VSIX package

## Marketplace Packaging

```bash
bun run package:vsix
```

## Privacy

- Your API key is stored securely in VS Code SecretStorage.
- The Zen provider base URL is `https://opencode.ai/zen/v1`.
