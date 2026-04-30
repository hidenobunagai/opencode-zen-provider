import * as vscode from "vscode";
import { EXTENSION_VERSION } from "./constants";
import { debugLog, getOutputChannel } from "./output-channel";
import { ZenChatModelProvider } from "./provider";
import { releaseCachedEncoding } from "./tokenizer";

let _provider: ZenChatModelProvider | null = null;

export function activate(context: vscode.ExtensionContext) {
  const ua = `opencode-zen-provider/${EXTENSION_VERSION} VSCode/${vscode.version}`;
  const channel = getOutputChannel();
  context.subscriptions.push(channel);
  const debugEnabled = context.globalState.get<boolean>("opencode-zen.debug", false);
  process.env.OPENCODE_ZEN_DEBUG = debugEnabled ? "1" : "0";
  debugLog(
    "activate",
    `Extension activated. Debug logging ${debugEnabled ? "enabled" : "disabled"}.`,
  );
  const provider = new ZenChatModelProvider(context.secrets, ua);
  _provider = provider;

  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === "opencode-zen.apiKey") {
        _provider?.fireModelInfoChanged();
      }
    }),
  );

  const registration = vscode.lm.registerLanguageModelChatProvider("opencode-zen", provider);
  context.subscriptions.push(registration);
  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-zen.manage", async () => {
      const existing = await context.secrets.get("opencode-zen.apiKey");
      const apiKey = await vscode.window.showInputBox({
        title: "OpenCode Zen API Key",
        prompt: existing ? "Update your OpenCode Zen API key" : "Enter your OpenCode Zen API key",
        ignoreFocusOut: true,
        password: true,
        value: existing ?? "",
        placeHolder: "Enter your OpenCode Zen API key...",
      });
      if (apiKey === undefined) {
        return;
      }
      if (!apiKey.trim()) {
        await context.secrets.delete("opencode-zen.apiKey");
        vscode.window.showInformationMessage("OpenCode Zen API key cleared.");
        _provider?.fireModelInfoChanged();
        return;
      }
      await context.secrets.store("opencode-zen.apiKey", apiKey.trim());
      vscode.window.showInformationMessage("OpenCode Zen API key saved.");
      _provider?.fireModelInfoChanged();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-zen.toggleDebugLogging", async () => {
      const current = context.globalState.get<boolean>("opencode-zen.debug", false);
      const next = !current;
      await context.globalState.update("opencode-zen.debug", next);
      process.env.OPENCODE_ZEN_DEBUG = next ? "1" : "0";
      debugLog("toggleDebug", `Debug logging ${next ? "enabled" : "disabled"}.`);
      vscode.window.showInformationMessage(
        `OpenCode Zen debug logging ${next ? "enabled" : "disabled"}.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-zen.openDebugLog", () => {
      const output = getOutputChannel();
      output.show(true);
    }),
  );
}

export function deactivate() {
  releaseCachedEncoding();
  _provider = null;
}
