import * as vscode from 'vscode';
import { ConfigManager } from './config';
import { Logger } from './logger';
import { SecretModeHandler } from './secretModeHandler';
import { SmartReplaceHandler } from './smartReplaceHandler';
import { StatusBarManager } from './statusBarManager';
import { TargetFileManager } from './targetFileManager';
import { NotificationManager } from './notificationManager';
import { SidebarProvider } from './sidebarProvider';

export function activate(context: vscode.ExtensionContext): void {
  const configManager = new ConfigManager();
  const logger = new Logger(() => configManager.value.enableLogging);
  const targetFileManager = new TargetFileManager(context, logger);

  // 初始化目标文件缓存（异步，不阻塞激活）
  targetFileManager.initialize().catch((error) => {
    logger.info(`Failed to initialize target file manager: ${error}`);
  });

  const statusBarManager = new StatusBarManager(targetFileManager);
  const notificationManager = new NotificationManager(configManager);
  const smartReplaceHandler = new SmartReplaceHandler(targetFileManager, logger, notificationManager);
  const secretModeHandler = new SecretModeHandler(
    targetFileManager,
    statusBarManager,
    smartReplaceHandler,
    logger,
    notificationManager,
  );
  const sidebarProvider = new SidebarProvider(targetFileManager, secretModeHandler);

  const subscriptions = [
    vscode.commands.registerCommand('demotyper.toggleSecretMode', () =>
      secretModeHandler.toggleSecretMode(),
    ),
    vscode.commands.registerCommand('demotyper.setAsTargetFile', (uri?: vscode.Uri) =>
      setTargetFile(uri),
    ),
    // Alias for compatibility with existing tests
    vscode.commands.registerCommand('demotyper.setTargetFile', (uri?: vscode.Uri) =>
      setTargetFile(uri),
    ),
    vscode.commands.registerCommand('demotyper.clearTargetFile', async () => {
      await targetFileManager.clearTargetFile();
      statusBarManager.update(secretModeHandler.state);
      sidebarProvider.refresh();
    }),
    vscode.commands.registerCommand('demotyper.clearAllTargets', async () => {
      await targetFileManager.clearAllTargets();
      statusBarManager.update(secretModeHandler.state);
      sidebarProvider.refresh();
    }),
    vscode.commands.registerCommand('demotyper.restoreCurrentFile', () => restoreActiveEditor()),
    vscode.commands.registerCommand('demotyper.jumpToNextGap', () => jumpToNextGap()),
    vscode.commands.registerCommand('demotyper.showDebugInfo', () => showDebugInfo()),
    configManager,
    statusBarManager,
    secretModeHandler,
    { dispose: () => logger.dispose() },
    vscode.window.registerTreeDataProvider('demotyper.panel', sidebarProvider),
    secretModeHandler.onDidChangeState(() => sidebarProvider.refresh()),
  ];

  context.subscriptions.push(...subscriptions);

  async function setTargetFile(uri?: vscode.Uri): Promise<void> {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      vscode.window.showWarningMessage('DemoTyper: Select a file before setting it as the target.');
      return;
    }
    await targetFileManager.setTargetFile(targetUri);
    statusBarManager.update(secretModeHandler.state);
    sidebarProvider.refresh();
  }

  async function restoreActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('DemoTyper: Open an editor to restore.');
      return;
    }
    if (!targetFileManager.hasTargetFile(editor.document.uri)) {
      vscode.window.showWarningMessage('DemoTyper: Set a demo target file first.');
      return;
    }
    await targetFileManager.restoreCurrentFile(editor);
  }

  async function jumpToNextGap(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('DemoTyper: Open an editor to jump to the next gap.');
      return;
    }
    if (!targetFileManager.hasTargetFile(editor.document.uri)) {
      vscode.window.showWarningMessage('DemoTyper: Set a demo target file first.');
      return;
    }
    await smartReplaceHandler.jumpToNextGap(editor);
  }

  async function showDebugInfo(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('DemoTyper: Open an editor to show debug info.');
      return;
    }
    if (!targetFileManager.hasTargetFile(editor.document.uri)) {
      vscode.window.showWarningMessage('DemoTyper: Set a demo target file first.');
      return;
    }
    await smartReplaceHandler.showDebugInfo(editor);
  }
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically; nothing to do here.
}
