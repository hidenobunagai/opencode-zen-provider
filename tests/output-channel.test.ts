import * as vscode from "vscode";
import { debugEnabled, debugLog, getOutputChannel } from "../src/output-channel";

const mockAppendLine = jest.fn();
const mockCreateOutputChannel = jest.fn((_name: string) => ({
  appendLine: mockAppendLine,
  show: jest.fn(),
  dispose: jest.fn(),
}));

jest.mock("vscode", () => ({
  window: { createOutputChannel: (name: string) => mockCreateOutputChannel(name) },
}));

type GlobalWithChannel = typeof globalThis & {
  __opencodeZenOutputChannel?: vscode.OutputChannel;
};

const clearGlobalChannel = () => {
  delete (globalThis as GlobalWithChannel).__opencodeZenOutputChannel;
};

describe("output channel", () => {
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    clearGlobalChannel();
    delete process.env.OPENCODE_ZEN_DEBUG;
    consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
    delete process.env.OPENCODE_ZEN_DEBUG;
    clearGlobalChannel();
  });

  it("creates the OpenCode Zen channel once and reuses it", () => {
    const channel = getOutputChannel();

    expect(mockCreateOutputChannel).toHaveBeenCalledWith("OpenCode Zen");
    expect(channel).toBe(mockCreateOutputChannel.mock.results[0].value);
    expect(getOutputChannel()).toBe(channel);
    expect(mockCreateOutputChannel).toHaveBeenCalledTimes(1);
  });

  it("treats only OPENCODE_ZEN_DEBUG=1 as enabled", () => {
    expect(debugEnabled()).toBe(false);
    process.env.OPENCODE_ZEN_DEBUG = "1";
    expect(debugEnabled()).toBe(true);
    process.env.OPENCODE_ZEN_DEBUG = "true";
    expect(debugEnabled()).toBe(false);
  });

  it("stays silent when debug logging is disabled", () => {
    debugLog("fetchWithRetry", "retrying");

    expect(mockCreateOutputChannel).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("appends formatted debug lines to the channel when enabled", () => {
    process.env.OPENCODE_ZEN_DEBUG = "1";
    const channel = getOutputChannel();

    debugLog("fetchWithRetry", { attempt: 1 });
    debugLog("streamChatCompletion", "raw text");

    expect(channel.appendLine).toHaveBeenCalledWith(
      '[OpenCode Zen Debug] fetchWithRetry: {\n  "attempt": 1\n}',
    );
    expect(channel.appendLine).toHaveBeenCalledWith(
      "[OpenCode Zen Debug] streamChatCompletion: raw text",
    );
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("falls back to console.log when enabled before a channel exists", () => {
    process.env.OPENCODE_ZEN_DEBUG = "1";

    debugLog("fetchWithRetry", { attempt: 1 });

    expect(mockCreateOutputChannel).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith("[OpenCode Zen Debug] fetchWithRetry:", {
      attempt: 1,
    });
  });
});
