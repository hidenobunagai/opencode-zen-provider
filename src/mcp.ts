import * as vscode from "vscode";
import { requestChatCompletion, resolveApiEndpoint } from "./api";
import { ZEN_MODEL_CATALOG } from "./model-catalog";

/**
 * OpenCode Zen MCP Client for making HTTP-based MCP tool calls.
 * Used internally to provide image analysis capabilities for non-vision models.
 */
export class ZenMcpClient {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly userAgent?: string,
  ) {}

  /** Read the API key fresh from SecretStorage unless a request-scoped key is provided. */
  private async getApiKey(apiKeyOverride?: string): Promise<string> {
    const normalizedApiKey = apiKeyOverride?.trim();
    if (normalizedApiKey) {
      return normalizedApiKey;
    }
    return (await this.secrets.get("opencode-zen.apiKey"))?.trim() ?? "";
  }

  /**
   * Analyze an image using an OpenCode Zen Vision model (default: gemini-3-flash).
   * Used to add image processing capabilities for non-vision models.
   *
   * @param imageData Base64-encoded image in data URL format (e.g. "data:image/png;base64,...")
   * @param prompt    What to analyze in the image
   * @returns         Image analysis result text
   */
  async analyzeImage(
    imageData: string,
    prompt: string,
    signal?: AbortSignal,
    apiKeyOverride?: string,
  ): Promise<string> {
    const apiKey = await this.getApiKey(apiKeyOverride);
    if (!apiKey) {
      throw new Error("OpenCode Zen API key not found");
    }

    const defaultVisionModel = "gemini-3-flash";
    const modelInfo = ZEN_MODEL_CATALOG.find((m) => m.id === defaultVisionModel);
    const routeKind = modelInfo?.routeKind ?? "model_specific";
    const endpoint = resolveApiEndpoint(routeKind, defaultVisionModel);

    const data = await requestChatCompletion(
      apiKey,
      {
        model: defaultVisionModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ],
        max_tokens: 2000,
      },
      endpoint,
      signal,
      this.userAgent,
    );

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Vision API returned no message content");
    }
    return content;
  }
}
