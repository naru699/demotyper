import * as vscode from 'vscode';
import { Logger } from './logger';
import { SmartReplaceHandler } from './smartReplaceHandler';
import { StatusBarManager } from './statusBarManager';
import { TargetFileManager } from './targetFileManager';
import { SecretModeState, SmartReplaceResult, UndoFriendlyEditOptions } from './types';
import { NotificationManager } from './notificationManager';

export class SecretModeHandler implements vscode.Disposable {
  private active = false;
  private readonly disposables: vscode.Disposable[] = [];
  private typingQueue: Promise<void> = Promise.resolve();
  private undoBatchOpen = false;
  private multiCursorWarningShown = false;
  private interceptDisposables: vscode.Disposable[] = [];
  private interceptsActive = false;
  private typingLocked = false;
  private readonly stateEmitter = new vscode.EventEmitter<SecretModeState>();
  readonly onDidChangeState = this.stateEmitter.event;

  constructor(
    private readonly targetFileManager: TargetFileManager,
    private readonly statusBarManager: StatusBarManager,
    private readonly smartReplaceHandler: SmartReplaceHandler,
    private readonly logger: Logger,
    private readonly notifications: NotificationManager,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (!this.active) {
          return;
        }
        await this.ensureSmartModeContext(editor);
      }),
      this.stateEmitter,
    );
  }

  get state(): SecretModeState {
    return { active: this.active };
  }

  async toggleSecretMode(): Promise<void> {
    if (this.active) {
      await this.disable();
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await this.notifications.warning('DemoTyper: Open an editor before enabling secret mode.');
      return;
    }

    if (!this.targetFileManager.hasTargetFile(editor.document.uri)) {
      await this.notifications.warning('DemoTyper: Set a demo target file before enabling secret mode (right-click the file > Set as Demo Target File).');
      return;
    }

    this.active = true;
    this.registerInterceptors();
    this.resetUndoBatch();
    this.multiCursorWarningShown = false;
    this.typingQueue = Promise.resolve();
    this.smartReplaceHandler.reset();
    this.logger.info('Secret mode enabled (smart).');

    this.statusBarManager.update(this.state);
    this.notifyStateChange();
    vscode.window.setStatusBarMessage('DemoTyper secret mode enabled (smart).', 2000);
  }

  async handleType(args: { text: string }): Promise<void> {
    if (!this.active) {
      await this.passThroughType(args);
      return;
    }

    if (this.typingLocked && !this.unlockTypingIfNeeded()) {
      return;
    }

    if (!this.hasTextEditorFocus()) {
      await this.passThroughType(args);
      return;
    }

    try {
      await this.queueWork(async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          await this.passThroughType(args);
          return;
        }
        this.ensureSingleCursor(editor);
        const result = await this.smartReplaceHandler.handleType(
          editor,
          args.text,
          () => this.getUndoFriendlyEditOptions(),
        );
        await this.handleSmartReplaceResult(result, args);
      });
    } catch (error) {
      this.logger.info(`handleType failed: ${String(error)}`);
      // 错误已记录，继续执行
    }
    // 注意：不要在每次编辑后调用 flushUndoBatchAfterEdit()
    // 保持 undoBatchOpen 为 true，直到秘密模式结束
    // 这样整个演示期间的所有编辑都在同一个撤销批次中
  }

  async handleBackspace(): Promise<void> {
    if (!this.active) {
      await vscode.commands.executeCommand('default:deleteLeft');
      return;
    }

    if (this.typingLocked && !this.unlockTypingIfNeeded()) {
      return;
    }

    if (!this.hasTextEditorFocus()) {
      await vscode.commands.executeCommand('default:deleteLeft');
      return;
    }

    try {
      await this.queueWork(async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          await vscode.commands.executeCommand('default:deleteLeft');
          return;
        }
        this.ensureSingleCursor(editor);
        await this.performBackspace(editor);
        this.typingLocked = true;
      });
    } catch (error) {
      this.logger.info(`handleBackspace failed: ${String(error)}`);
      // 错误已记录，继续执行
    }
    // 注意：不要在每次编辑后调用 flushUndoBatchAfterEdit()
    // 保持 undoBatchOpen 为 true，直到秘密模式结束
  }

  async disable(): Promise<void> {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.disposeInterceptors();
    this.resetUndoBatch();
    this.multiCursorWarningShown = false;
    this.typingQueue = Promise.resolve();
    this.smartReplaceHandler.reset();
    this.statusBarManager.update(this.state);
    this.notifyStateChange();
    vscode.window.setStatusBarMessage('DemoTyper secret mode disabled.', 2000);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposeInterceptors();
  }

  private async passThroughType(args: { text: string }): Promise<void> {
    await vscode.commands.executeCommand('default:type', args);
  }

  private getUndoFriendlyEditOptions(): UndoFriendlyEditOptions {
    const undoStopBefore = !this.undoBatchOpen;
    this.undoBatchOpen = true;
    return { undoStopBefore, undoStopAfter: false };
  }

  private resetUndoBatch(): void {
    this.undoBatchOpen = false;
  }

  private flushUndoBatchAfterEdit(): void {
    this.undoBatchOpen = false;
  }

  private ensureSingleCursor(editor: vscode.TextEditor): vscode.Selection {
    if (editor.selections.length === 1) {
      return editor.selection;
    }

    if (!this.multiCursorWarningShown) {
      void this.notifications.warning('DemoTyper: Secret mode使用单光标以保证脚本一致，已保留主光标。');
      this.multiCursorWarningShown = true;
    }
    const primary = editor.selection;
    editor.selections = [primary];
    return primary;
  }

  private async performBackspace(editor: vscode.TextEditor): Promise<void> {
    const selection = editor.selection;
    const doc = editor.document;
    let range: vscode.Range | undefined;

    if (!selection.isEmpty) {
      range = selection;
    } else {
      const anchorOffset = doc.offsetAt(selection.start);
      if (anchorOffset === 0) {
        return;
      }
      const newStart = doc.positionAt(anchorOffset - 1);
      range = new vscode.Range(newStart, selection.start);
    }

    if (!range || range.isEmpty) {
      return;
    }

    const removedLength = doc.offsetAt(range.end) - doc.offsetAt(range.start);
    const editOptions = this.getUndoFriendlyEditOptions();
    const applied = await editor.edit(
      (editBuilder) => {
        editBuilder.delete(range);
      },
      editOptions,
    );

    if (!applied) {
      this.logger.info('[WARN] Backspace edit failed - edit was not applied');
      return;
    }

    // 通知 smartReplaceHandler 删除操作，以更新占位符偏移量
    const deleteOffset = doc.offsetAt(range.start);
    this.smartReplaceHandler.notifyDeletion(deleteOffset, removedLength);

    editor.selection = new vscode.Selection(range.start, range.start);
  }

  private queueWork<T>(work: () => Promise<T>): Promise<T> {
    const next = this.typingQueue.then(() => work());
    this.typingQueue = next.then(
      () => undefined,
      (error) => {
        this.logger.info(`Secret mode task failed: ${String(error)}`);
        return undefined;
      },
    );
    return next;
  }

  private hasTextEditorFocus(): boolean {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !vscode.window.state.focused) {
      return false;
    }

    // 排除不应该处理的 scheme（如输出面板、git diff、调试控制台等）
    // 而不是只允许特定的 scheme，这样可以支持远程 SSH/WSL/容器等
    const excludedSchemes = new Set([
      'output', // 输出面板
      'git', // Git diff 视图
      'debug', // 调试控制台
      'vscode-notebook-cell', // Notebook 单元格
      'vscode-userdata', // 用户数据
    ]);
    if (excludedSchemes.has(editor.document.uri.scheme)) {
      return false;
    }

    return editor.viewColumn !== undefined;
  }

  private async handleSmartReplaceResult(result: SmartReplaceResult, args: { text: string }): Promise<void> {
    if (result === 'applied') {
      return;
    }

    if (result === 'inSync') {
      await this.notifications.info('DemoTyper: 当前文件已与目标文件一致，秘密模式自动关闭。');
      await this.disable();
      return;
    }

    if (result === 'outOfSync') {
      await this.notifications.warning('DemoTyper: 当前文件与目标文件不一致，请先使用 Restore Current File 命令。');
      await this.disable();
      await this.passThroughType(args);
      return;
    }

    if (result === 'targetMissing') {
      const action = await this.notifications.warning(
        'DemoTyper: 无法读取目标文件，请检查文件是否仍然存在或可访问。',
        '重试',
        '退出秘密模式',
      );

      if (action === '退出秘密模式') {
        await this.disable();
        await this.passThroughType(args);
        return;
      }

      if (action === '重试') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        const retryResult = await this.smartReplaceHandler.handleType(
          editor,
          undefined,
          () => this.getUndoFriendlyEditOptions(),
        );
        await this.handleSmartReplaceResult(retryResult, args);
        return;
      }

      await this.notifications.info('DemoTyper: 修复目标文件后继续敲击键盘即可重新尝试。');
    }
  }

  private async ensureSmartModeContext(editor: vscode.TextEditor | undefined): Promise<void> {
    if (editor && this.targetFileManager.hasTargetFile(editor.document.uri)) {
      this.smartReplaceHandler.reset();
      this.statusBarManager.update(this.state);
      this.notifyStateChange();
      return;
    }

    await this.notifications.warning('DemoTyper: 当前编辑器没有目标文件，秘密模式已自动关闭。');
    await this.disable();
  }

  private registerInterceptors(): void {
    if (this.interceptsActive) {
      return;
    }
    this.interceptsActive = true;
    this.interceptDisposables = [
      vscode.commands.registerCommand('type', (args) => this.handleType(args)),
      vscode.commands.registerCommand('deleteLeft', () => this.handleBackspace()),
    ];
  }

  private disposeInterceptors(): void {
    if (!this.interceptsActive) {
      return;
    }
    this.interceptDisposables.forEach((d) => d.dispose());
    this.interceptDisposables = [];
    this.interceptsActive = false;
  }

  private notifyStateChange(): void {
    this.stateEmitter.fire(this.state);
  }

  private unlockTypingIfNeeded(): boolean {
    if (!this.typingLocked) {
      return true;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return false;
    }

    if (!editor.selection.isEmpty || editor.document.isDirty) {
      this.typingLocked = false;
      return true;
    }

    return false;
  }

}
