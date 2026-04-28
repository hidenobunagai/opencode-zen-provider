import * as vscode from "vscode";

const OUTPUT_CHANNEL_NAME = "OpenCode Zen";

function getGlobalOutputChannel(): vscode.OutputChannel | undefined {
  const globalWindow = globalThis as typeof globalThis & {
    __opencodeZenOutputChannel?: vscode.OutputChannel;
  };
  return globalWindow.__opencodeZenOutputChannel;
}

function setGlobalOutputChannel(channel: vscode.OutputChannel): void {
  const globalWindow = globalThis as typeof globalThis & {
    __opencodeZenOutputChannel?: vscode.OutputChannel;
  };
  globalWindow.__opencodeZenOutputChannel = channel;
}

export function getOutputChannel(): vscode.OutputChannel {
  let channel = getGlobalOutputChannel();
  if (!channel) {
    channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    setGlobalOutputChannel(channel);
  }
  return channel;
}

export function debugEnabled(): boolean {
  return process.env.OPENCODE_ZEN_DEBUG === "1";
}

export function debugLog(label: string, value: unknown): void {
  if (!debugEnabled()) {
    return;
  }
  const message = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const channel = getGlobalOutputChannel();
  if (channel) {
    channel.appendLine(`[OpenCode Zen Debug] ${label}: ${message}`);
    return;
  }
  console.log(`[OpenCode Zen Debug] ${label}:`, value);
}
