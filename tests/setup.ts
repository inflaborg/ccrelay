import { vi } from "vitest";

// Mock vscode module
vi.mock("vscode", () => {
  return {
    /* eslint-disable @typescript-eslint/naming-convention */
    window: {
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      createStatusBarItem: vi.fn(() => ({
        show: vi.fn(),
        hide: vi.fn(),
        text: "",
        tooltip: "",
        command: "",
        dispose: vi.fn(),
      })),
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        show: vi.fn(),
        dispose: vi.fn(),
      })),
    },
    workspace: {
      getConfiguration: vi.fn(_section => ({
        get: vi.fn((key, defaultValue) => defaultValue), // eslint-disable-line @typescript-eslint/no-unsafe-return
        update: vi.fn(),
      })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      workspaceFolders: [],
    },
    commands: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
      executeCommand: vi.fn(),
    },
    ExtensionContext: vi.fn(),
    StatusBarAlignment: { Right: 1, Left: 2 },
    Disposable: {
      from: vi.fn(),
    },
    Uri: {
      parse: vi.fn(url => ({ fsPath: url })), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      file: vi.fn(path => ({ fsPath: path })), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    },
  };
});
