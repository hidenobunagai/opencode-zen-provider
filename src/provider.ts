import * as vscode from "vscode";
import { EventEmitter } from "vscode";
import type {
  CancellationToken,
  Event,
  LanguageModelChatInformation,
  LanguageModelChatMessage,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart,
  PrepareLanguageModelChatModelOptions,
  Progress,
  ProvideLanguageModelChatResponseOptions,
} from "vscode";
import {
  calculateSafetyMargin,
  DEFAULT_MAX_OUTPUT_TOKENS,
  REASONING_MODEL_MIN_OUTPUT_BUDGET,
  THINKING_MODELS,
} from "./constants";
import { extractImageData, getTextPartValue, type LegacyPart } from "./message-parts";
import { NO_TOOL_MODEL_IDS, ZEN_MODEL_CATALOG, type ZenModelInfo } from "./model-catalog";
import { ZenMcpClient } from "./mcp";
import { debugLog } from "./output-channel";
import { handleAnthropicRequest } from "./streaming/anthropic";
import { processOpenAIStream, type OpenAIModelInfo } from "./streaming/openai";
import { estimateMessagesTokens, estimateTokens } from "./tokenizer";

export class ZenChatModelProvider implements LanguageModelChatProvider {
  private readonly _onDidChangeLanguageModelChatInformation = new EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation: Event<void> =
    this._onDidChangeLanguageModelChatInformation.event;

  private readonly _mcpClient: ZenMcpClient;
  private readonly _modelMap: Map<string, ZenModelInfo>;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly userAgent: string,
  ) {
    this._mcpClient = new ZenMcpClient(secrets, userAgent);
    this._modelMap = new Map(ZEN_MODEL_CATALOG.map((m) => [m.id, m]));
  }

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
    return this._modelMap.get(modelId);
  }

  private resolveApiModelId(modelId: string): string {
    const colonIndex = modelId.indexOf(":");
    return colonIndex > 0 ? modelId.slice(0, colonIndex) : modelId;
  }

  private modelSupportsVision(modelId: string): boolean {
    return this.getModelInfo(modelId)?.supportsVision ?? false;
  }

  private getVisionFallbackModelId(): string | undefined {
    const gemini = this._modelMap.get("gemini-3-flash");
    if (gemini && gemini.supportsVision) return gemini.id;
    for (const m of this._modelMap.values()) {
      if (m.supportsVision) return m.id;
    }
    return undefined;
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

  private async processImagesForNonVisionModel(
    messages: readonly LanguageModelChatMessage[],
    token: CancellationToken,
    apiKey: string,
  ): Promise<LanguageModelChatMessage[]> {
    const processedMessages: LanguageModelChatMessage[] = [];

    for (const msg of messages) {
      const textParts: string[] = [];
      for (const part of msg.content) {
        const textValue = getTextPartValue(part);
        if (textValue !== undefined) textParts.push(textValue);
      }

      const images: Array<{ mimeType: string; data: Uint8Array }> = [];
      for (const part of msg.content) {
        const image = extractImageData(part);
        if (image) images.push(image);
      }

      if (images.length === 0) {
        processedMessages.push(msg);
        continue;
      }

      const userPrompt = textParts.join(" ");
      const abortController = new AbortController();
      const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());

      const descriptions = await Promise.all(
        images.map(async (img) => {
          if (token.isCancellationRequested) throw new vscode.CancellationError();
          const base64Data = Buffer.from(img.data).toString("base64");
          const imageDataUrl = `data:${img.mimeType};base64,${base64Data}`;
          const analysisPrompt = userPrompt || "Describe this image in detail.";
          return this._mcpClient.analyzeImage(
            imageDataUrl,
            analysisPrompt,
            abortController.signal,
            apiKey,
          );
        }),
      ).finally(() => cancellationSubscription.dispose());

      const newContent: vscode.LanguageModelTextPart[] = textParts.map(
        (t) => new vscode.LanguageModelTextPart(t),
      );
      if (descriptions.length > 0) {
        newContent.push(
          new vscode.LanguageModelTextPart(
            `\n\n[Image Analysis]:\n${descriptions.join("\n\n---\n\n")}`,
          ),
        );
      }
      processedMessages.push(vscode.LanguageModelChatMessage.User(newContent));
    }

    return processedMessages;
  }

  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatModelOptions,
    token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    if (token.isCancellationRequested) return [];
    try {
      await this.syncConfiguredApiKey(options);
      const models = this._mapToChatInformation(ZEN_MODEL_CATALOG);
      debugLog("provideLanguageModelChatInformation", {
        silent: options.silent,
        modelCount: models.length,
      });
      return models;
    } catch (error) {
      debugLog("provideLanguageModelChatInformationError", error);
      const models = this._mapToChatInformation(ZEN_MODEL_CATALOG);
      return models;
    }
  }

  private _mapToChatInformation(
    models: Array<{ id: string; name: string }>,
  ): LanguageModelChatInformation[] {
    return models.map((model) => {
      const info = this._modelMap.get(model.id) ?? {
        id: model.id,
        name: model.name,
        displayName: model.name,
        contextWindow: 262144,
        maxOutput: 65536,
        supportsTools: true,
        supportsVision: false,
        supportsThinking: false,
      };
      const isReasoning = THINKING_MODELS.has(model.id);
      // Reasoning/thinking models self-regulate output via the API.
      // Use the minimum output budget as a fixed headroom instead of the
      // model's declared maxOutput (which may equal the full context window).
      const effectiveOutputBudget = isReasoning
        ? REASONING_MODEL_MIN_OUTPUT_BUDGET
        : Math.min(info.maxOutput, DEFAULT_MAX_OUTPUT_TOKENS);
      return {
        id: info.id,
        name: info.displayName,
        detail: "OpenCode Zen",
        tooltip: `OpenCode Zen ${info.name}`,
        family: "opencode-zen",
        version: "1.0.0",
        isUserSelectable: true,
        maxInputTokens: Math.max(1, info.contextWindow - effectiveOutputBudget),
        maxOutputTokens: info.maxOutput,
        capabilities: {
          toolCalling: info.supportsTools,
          imageInput: info.supportsVision,
        },
        ...(info.supportsThinking
          ? {
              configurationSchema: {
                properties: {
                  reasoningEffort: {
                    type: "string",
                    title: "Thinking Effort",
                    enum: ["default", "max", "high", "medium", "low"],
                    enumItemLabels: ["Default", "Max", "High", "Medium", "Low"],
                    enumDescriptions: [
                      "Let the model decide the reasoning effort",
                      "Maximum reasoning effort (xhigh)",
                      "High reasoning effort",
                      "Medium reasoning effort",
                      "Low reasoning effort",
                    ],
                    default: "default",
                    group: "navigation",
                  },
                },
              },
            }
          : {}),
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
      const [apiKey, inputTokenCount] = await Promise.all([
        this.ensureApiKey(options, false),
        Promise.resolve(estimateMessagesTokens(messages as never, model.id)),
      ]);
      if (!apiKey) {
        progress.report(
          new vscode.LanguageModelTextPart(
            'OpenCode Zen API key is not configured. Add or configure OpenCode Zen from the chat model picker, run "OpenCode Zen: Manage OpenCode Zen API Key" from the Command Palette, or retry this request and enter the key when prompted.',
          ),
        );
        return;
      }

      const maxInputTokens = model.maxInputTokens;
      const effectiveMaxInputTokens = Math.max(
        1,
        maxInputTokens - calculateSafetyMargin(maxInputTokens),
      );

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

      // Thinking models consume part of the max_tokens budget for internal reasoning.
      // Enforce a minimum output budget so the model has enough room to reason AND produce a visible response.
      const resolvedModelId = this.resolveApiModelId(model.id);
      const isThinkingModel = THINKING_MODELS.has(resolvedModelId);
      const effectiveMaxTokens = isThinkingModel
        ? Math.max(
            requestedMaxTokens,
            Math.min(REASONING_MODEL_MIN_OUTPUT_BUDGET, model.maxOutputTokens),
          )
        : requestedMaxTokens;

      const modelInfo = this.getModelInfo(model.id);
      const apiFormat = modelInfo?.apiFormat ?? "openai";
      const modelConfig = (options as unknown as Record<string, unknown>).modelConfiguration as
        | Record<string, unknown>
        | undefined;
      const rawReasoningEffort =
        typeof modelConfig?.reasoningEffort === "string"
          ? (modelConfig.reasoningEffort as string)
          : undefined;
      const reasoningEffort = rawReasoningEffort === "default" ? undefined : rawReasoningEffort;
      const temperatureVal =
        typeof modelInfo?.fixedTemperature === "number"
          ? modelInfo.fixedTemperature
          : typeof (options.modelOptions as Record<string, unknown>)?.temperature === "number"
            ? ((options.modelOptions as Record<string, unknown>).temperature as number)
            : 0.7;

      const hasImages = this.hasImageInput(messages);
      let effectiveMessages = messages;
      let effectiveModelId = this.resolveApiModelId(model.id);
      let effectiveModelInfo = this.getModelInfo(effectiveModelId);

      if (hasImages && !this.modelSupportsVision(model.id)) {
        const visionFallback = this.getVisionFallbackModelId();
        if (visionFallback && visionFallback !== model.id) {
          effectiveModelId = this.resolveApiModelId(visionFallback);
          effectiveModelInfo = this._modelMap.get(visionFallback);
          const selectedModelInfo = this.getModelInfo(model.id);
          progress.report(
            new vscode.LanguageModelTextPart(
              `Switching to ${effectiveModelInfo?.displayName ?? visionFallback} for image analysis (${selectedModelInfo?.displayName ?? model.id} does not support vision).\n\n`,
            ),
          );
        } else {
          try {
            effectiveMessages = await this.processImagesForNonVisionModel(messages, token, apiKey);
          } catch (err) {
            if (err instanceof vscode.CancellationError || token.isCancellationRequested) {
              throw err;
            }
            const message = err instanceof Error ? err.message : String(err);
            progress.report(
              new vscode.LanguageModelTextPart(
                `Image analysis failed: ${message}. The selected model (${effectiveModelInfo?.displayName ?? model.id}) does not support vision and no vision fallback model is available. Please switch to a vision-capable model and try again.`,
              ),
            );
            return;
          }
        }
      }

      const requestOptions = NO_TOOL_MODEL_IDS.has(model.id)
        ? ({ ...options, tools: [] } as ProvideLanguageModelChatResponseOptions)
        : options;

      if (apiFormat === "anthropic") {
        await handleAnthropicRequest({
          modelId: effectiveModelId,
          messages: effectiveMessages,
          options,
          requestOptions,
          apiKey,
          requestedMaxTokens: effectiveMaxTokens,
          temperatureVal,
          reasoningEffort,
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
        modelInfo: effectiveModelInfo,
        maxOutputTokens: model.maxOutputTokens,
        routeKind: effectiveModelInfo?.routeKind,
      };

      await processOpenAIStream(
        openAIModel,
        effectiveMessages,
        options,
        requestOptions,
        apiKey,
        effectiveMaxTokens,
        temperatureVal,
        ZEN_MODEL_CATALOG,
        this.userAgent,
        progress,
        token,
        abortController,
        reasoningEffort,
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
    const textParts: string[] = [];
    for (const part of text.content) {
      const textValue = getTextPartValue(part as vscode.LanguageModelInputPart | LegacyPart);
      if (textValue !== undefined) textParts.push(textValue);
    }
    if (textParts.length === 0) {
      return Promise.resolve(2 * text.content.length);
    }
    return Promise.resolve(estimateTokens(textParts.join(" ")));
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
