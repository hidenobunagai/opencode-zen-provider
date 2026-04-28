import * as vscode from "vscode";
import {
  CancellationToken,
  Event,
  EventEmitter,
  LanguageModelChatInformation,
  LanguageModelChatMessage,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart,
  PrepareLanguageModelChatModelOptions,
  Progress,
  ProvideLanguageModelChatResponseOptions,
} from "vscode";
import { CONTEXT_WINDOW_SAFETY_MARGIN, DEFAULT_MAX_OUTPUT_TOKENS } from "./constants";
import { ZEN_MODEL_CATALOG, ZenModelInfo } from "./model-catalog";
import { handleAnthropicRequest } from "./streaming/anthropic";
import { processOpenAIStream, type OpenAIModelInfo } from "./streaming/openai";
import { estimateMessagesTokens, estimateTokens } from "./tokenizer";

export class ZenChatModelProvider implements LanguageModelChatProvider {
  private readonly _onDidChangeLanguageModelChatInformation = new EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation: Event<void> =
    this._onDidChangeLanguageModelChatInformation.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly userAgent: string,
  ) {}

  fireModelInfoChanged(): void {
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  private getConfiguredApiKeyState(configuration: unknown): {
    hasApiKeyProperty: boolean;
    apiKey?: string;
  } {
    if (!configuration || typeof configuration !== "object") {
      return { hasApiKeyProperty: false };
    }

    const configurationRecord = configuration as { apiKey?: unknown };
    if (!("apiKey" in configurationRecord)) {
      return { hasApiKeyProperty: false };
    }

    const apiKey = configurationRecord.apiKey;
    if (typeof apiKey !== "string") {
      return { hasApiKeyProperty: true };
    }

    const normalizedApiKey = apiKey.trim();
    return {
      hasApiKeyProperty: true,
      apiKey: normalizedApiKey || undefined,
    };
  }

  private async syncConfiguredApiKey(options: unknown): Promise<string | undefined> {
    if (!options || typeof options !== "object") {
      return undefined;
    }

    const optionsRecord = options as { configuration?: unknown; modelConfiguration?: unknown };
    const modelConfigurationState = this.getConfiguredApiKeyState(optionsRecord.modelConfiguration);
    const providerConfigurationState = this.getConfiguredApiKeyState(optionsRecord.configuration);
    const hasExplicitApiKeyProperty =
      modelConfigurationState.hasApiKeyProperty || providerConfigurationState.hasApiKeyProperty;
    if (!hasExplicitApiKeyProperty) {
      return undefined;
    }

    const configuredApiKey = modelConfigurationState.apiKey ?? providerConfigurationState.apiKey;
    const storedApiKey = await this.secrets.get("opencode-zen.apiKey");
    if (!configuredApiKey) {
      if (storedApiKey !== undefined) {
        await this.secrets.delete("opencode-zen.apiKey");
      }
      return undefined;
    }

    if (storedApiKey !== configuredApiKey) {
      await this.secrets.store("opencode-zen.apiKey", configuredApiKey);
    }

    return configuredApiKey;
  }

  private getModelInfo(modelId: string): ZenModelInfo | undefined {
    return ZEN_MODEL_CATALOG.find((m) => m.id === modelId);
  }

  private resolveApiModelId(modelId: string): string {
    const colonIndex = modelId.indexOf(":");
    return colonIndex > 0 ? modelId.slice(0, colonIndex) : modelId;
  }

  private modelSupportsVision(modelId: string): boolean {
    return this.getModelInfo(modelId)?.supportsVision ?? false;
  }

  private hasImageInput(messages: readonly LanguageModelChatMessage[]): boolean {
    for (const msg of messages) {
      for (const part of msg.content) {
        const p = part as unknown as Record<string, unknown>;
        if (typeof p.mimeType === "string" && p.mimeType.startsWith("image/")) return true;
      }
    }
    return false;
  }

  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatModelOptions,
    token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    if (token.isCancellationRequested) return [];
    await this.syncConfiguredApiKey(options);
    return this._mapToChatInformation(ZEN_MODEL_CATALOG);
  }

  private _mapToChatInformation(
    models: Array<{ id: string; name: string }>,
  ): LanguageModelChatInformation[] {
    return models.map((model) => {
      const info = ZEN_MODEL_CATALOG.find((m) => m.id === model.id) ?? {
        id: model.id,
        name: model.name,
        displayName: model.name,
        contextWindow: 262144,
        maxOutput: 65536,
        supportsTools: true,
        supportsVision: false,
      };
      return {
        id: info.id,
        name: info.displayName,
        detail: "OpenCode Zen",
        tooltip: `OpenCode Zen ${info.name}`,
        family: "opencode-zen",
        version: "1.0.0",
        maxInputTokens: Math.max(
          1,
          info.contextWindow - Math.min(info.maxOutput, DEFAULT_MAX_OUTPUT_TOKENS),
        ),
        maxOutputTokens: info.maxOutput,
        capabilities: {
          toolCalling: info.supportsTools ? 128 : false,
          imageInput: info.supportsVision,
        },
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    const abortController = new AbortController();
    const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());

    try {
      const apiKey = await this.ensureApiKey(options, false);
      if (!apiKey) {
        progress.report(
          new vscode.LanguageModelTextPart(
            'OpenCode Zen API key is not configured. Add or configure OpenCode Zen from the chat model picker, run "OpenCode Zen: Manage OpenCode Zen API Key" from the Command Palette, or retry this request and enter the key when prompted.',
          ),
        );
        return;
      }

      const inputTokenCount = estimateMessagesTokens(
        messages as never, // cast needed for VS Code API type compatibility
        model.id,
      );
      const maxInputTokens = model.maxInputTokens;
      const effectiveMaxInputTokens = Math.max(1, maxInputTokens - CONTEXT_WINDOW_SAFETY_MARGIN);

      if (inputTokenCount > effectiveMaxInputTokens) {
        throw new Error(
          `Message exceeds token limit (${inputTokenCount} > ${effectiveMaxInputTokens}). Try reducing the conversation history or switching to a model with a larger context window.`,
        );
      }

      const maxTokensVal = (options.modelOptions as Record<string, unknown>)?.max_tokens;
      const requestedMaxTokens = Math.min(
        typeof maxTokensVal === "number" ? maxTokensVal : DEFAULT_MAX_OUTPUT_TOKENS,
        model.maxOutputTokens,
      );

      const modelInfo = this.getModelInfo(model.id);
      const apiFormat = modelInfo?.apiFormat ?? "openai";
      const reasoningEffort = modelInfo?.reasoningEffort;
      const temperatureVal =
        typeof modelInfo?.fixedTemperature === "number"
          ? modelInfo.fixedTemperature
          : typeof (options.modelOptions as Record<string, unknown>)?.temperature === "number"
            ? ((options.modelOptions as Record<string, unknown>).temperature as number)
            : 0.7;

      const hasImages = this.hasImageInput(messages);
      const effectiveMessages = messages;
      const effectiveModelId = this.resolveApiModelId(model.id);

      if (hasImages && !this.modelSupportsVision(model.id)) {
        throw new Error(
          `The selected OpenCode Zen model (${model.id}) does not support image input in V1. Choose a vision-capable model and retry.`,
        );
      }

      if (apiFormat === "anthropic") {
        await handleAnthropicRequest({
          modelId: effectiveModelId,
          messages: effectiveMessages,
          options,
          apiKey,
          requestedMaxTokens,
          temperatureVal,
          userAgent: this.userAgent,
          fallbackModels: ZEN_MODEL_CATALOG,
          progress,
          token,
          abortController,
        });
        return;
      }

      const openAIModel: OpenAIModelInfo = {
        id: effectiveModelId,
        modelInfo,
        maxOutputTokens: model.maxOutputTokens,
        reasoningEffort,
        routeKind: modelInfo?.routeKind,
      };

      await processOpenAIStream(
        openAIModel,
        effectiveMessages,
        options,
        apiKey,
        requestedMaxTokens,
        temperatureVal,
        ZEN_MODEL_CATALOG,
        this.userAgent,
        progress,
        token,
        abortController,
      );
    } catch (err) {
      if (token.isCancellationRequested || (err instanceof Error && err.name === "AbortError")) {
        throw new vscode.CancellationError();
      }
      throw err;
    } finally {
      cancellationSubscription.dispose();
    }
  }

  provideTokenCount(
    _model: LanguageModelChatInformation,
    text: string | LanguageModelChatRequestMessage,
    _token: CancellationToken,
  ): Promise<number> {
    if (typeof text === "string") {
      return Promise.resolve(estimateTokens(text));
    }
    let total = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        total += estimateTokens(part.value);
      } else if (
        typeof part === "object" &&
        part !== null &&
        "value" in part &&
        typeof (part as Record<string, unknown>).value === "string"
      ) {
        total += estimateTokens((part as { value: string }).value);
      } else {
        total += 2;
      }
    }
    return Promise.resolve(total);
  }

  private async ensureApiKey(options: unknown, silent: boolean): Promise<string | undefined> {
    const configuredApiKey = await this.syncConfiguredApiKey(options);
    if (configuredApiKey) {
      return configuredApiKey;
    }

    let apiKey = (await this.secrets.get("opencode-zen.apiKey"))?.trim();
    if (!apiKey && !silent) {
      const entered = await vscode.window.showInputBox({
        title: "OpenCode Zen API Key",
        prompt: "Enter your OpenCode Zen API key",
        ignoreFocusOut: true,
        password: true,
      });
      if (entered && entered.trim()) {
        apiKey = entered.trim();
        await this.secrets.store("opencode-zen.apiKey", apiKey);
      }
    }
    return apiKey;
  }
}
