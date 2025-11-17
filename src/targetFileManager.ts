import * as vscode from 'vscode';
import { Logger } from './logger';
import { TargetFileSnapshot, TargetsMap } from './types';

const SNAPSHOT_FILENAME = 'targetSnapshot.json';

export class TargetFileManager {
  private readonly snapshotFileUri: vscode.Uri;
  private targetsCache?: TargetsMap;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
  ) {
    this.snapshotFileUri = vscode.Uri.joinPath(context.globalStorageUri, SNAPSHOT_FILENAME);
  }

  /**
   * 初始化缓存，在扩展激活时调用
   * 确保 targetsCache 被加载，避免后续同步方法返回 undefined
   */
  async initialize(): Promise<void> {
    await this.loadTargets();
    this.logger.info(`Target file manager initialized, loaded ${Object.keys(this.targetsCache ?? {}).length} target(s)`);
  }

  async setTargetFile(uri?: vscode.Uri): Promise<void> {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      vscode.window.showWarningMessage('DemoTyper: No file to set as target.');
      return;
    }

    try {
      const buffer = await vscode.workspace.fs.readFile(targetUri);
      const snapshot: TargetFileSnapshot = {
        uri: targetUri.toString(),
        savedAt: Date.now(),
        content: Buffer.from(buffer).toString('utf8'),
      };

      const key = this.getKeyForUri(targetUri);
      const targets = await this.loadTargets();
      targets[key] = snapshot;
      await this.saveTargets(targets);

      this.logger.info(`Set target file snapshot: ${key} (${snapshot.uri})`);
      vscode.window.showInformationMessage(`DemoTyper target file set: ${this.getLabelForUri(targetUri)}`);
      this.changeEmitter.fire();
    } catch (error) {
      this.logger.info(`Failed to capture target file snapshot: ${error}`);
      vscode.window.showErrorMessage('DemoTyper could not capture the file you selected. Please try again.');
    }
  }

  async clearTargetFile(uri?: vscode.Uri): Promise<void> {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      vscode.window.showWarningMessage('DemoTyper: No active editor to clear target.');
      return;
    }

    const key = this.getKeyForUri(targetUri);
    const targets = await this.loadTargets();

    if (!targets[key]) {
      vscode.window.showWarningMessage('DemoTyper: Current file does not have a target snapshot.');
      return;
    }

    delete targets[key];
    await this.saveTargets(targets);

    this.logger.info(`Cleared target file: ${key}`);
    vscode.window.showInformationMessage('DemoTyper target file cleared');
    this.changeEmitter.fire();
  }

  async clearAllTargets(): Promise<void> {
    await this.deleteSnapshotFile();
    this.logger.info('Cleared all target files');
    vscode.window.showInformationMessage('DemoTyper: All target files cleared');
    this.changeEmitter.fire();
  }

  getSnapshotForUri(uri: vscode.Uri): TargetFileSnapshot | undefined {
    if (!this.targetsCache) {
      return undefined;
    }
    const key = this.getKeyForUri(uri);
    return this.targetsCache[key];
  }

  async readTargetContent(uri?: vscode.Uri): Promise<string | undefined> {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      this.logger.info('No active editor to read target content.');
      vscode.window.showErrorMessage('DemoTyper: No active editor.');
      return undefined;
    }

    // 优先使用同步缓存，避免不必要的异步操作和潜在的竞态条件
    let snapshot = this.getSnapshotForUri(targetUri);
    if (!snapshot) {
      // 缓存未命中，异步加载
      snapshot = await this.getSnapshotForUriAsync(targetUri);
    }

    if (!snapshot) {
      this.logger.info(`Target file snapshot missing for: ${this.getKeyForUri(targetUri)}`);
      vscode.window.showErrorMessage('DemoTyper could not read the stored target file snapshot.');
      return undefined;
    }
    return snapshot.content;
  }

  async restoreCurrentFile(editor: vscode.TextEditor): Promise<void> {
    const content = await this.readTargetContent(editor.document.uri);
    if (content === undefined) {
      return;
    }

    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length),
    );

    await editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, content);
    });
  }

  hasTargetFile(uri?: vscode.Uri): boolean {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      return false;
    }
    const key = this.getKeyForUri(targetUri);
    return Boolean(this.targetsCache?.[key]);
  }

  getTargetFileLabel(uri?: vscode.Uri): string {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      return 'None';
    }

    const snapshot = this.getSnapshotForUri(targetUri);
    if (!snapshot) {
      return 'None';
    }

    return this.getLabelForUri(targetUri);
  }

  getAllTargets(): TargetsMap {
    return this.targetsCache ?? {};
  }

  getTargetFileUri(): vscode.Uri | undefined {
    // 为了兼容性保留，返回当前编辑器的目标文件 URI
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    const snapshot = this.getSnapshotForUri(editor.document.uri);
    return snapshot ? vscode.Uri.parse(snapshot.uri) : undefined;
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  private async getSnapshotForUriAsync(uri: vscode.Uri): Promise<TargetFileSnapshot | undefined> {
    const targets = await this.loadTargets();
    const key = this.getKeyForUri(uri);
    return targets[key];
  }

  private async loadTargets(): Promise<TargetsMap> {
    if (this.targetsCache) {
      return this.targetsCache;
    }

    try {
      const raw = await vscode.workspace.fs.readFile(this.snapshotFileUri);
      const text = Buffer.from(raw).toString('utf8');
      const parsed = JSON.parse(text);

      // 检测并迁移旧格式
      if (this.isOldFormatSnapshot(parsed)) {
        this.logger.info('Detected old snapshot format, migrating to new format...');
        const migrated = this.migrateOldFormat(parsed);
        await this.saveTargets(migrated);
        return migrated;
      }

      if (this.isValidTargetsMap(parsed)) {
        this.targetsCache = parsed;
        return parsed;
      }

      this.logger.info('Invalid target file snapshot format detected.');
      return {};
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        this.targetsCache = {};
        return {};
      }
      this.logger.info(`Failed to load target file snapshot: ${error}`);
      return {};
    }
  }

  private async saveTargets(targets: TargetsMap): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    await vscode.workspace.fs.writeFile(
      this.snapshotFileUri,
      Buffer.from(JSON.stringify(targets, null, 2), 'utf8'),
    );
    this.targetsCache = targets;
  }

  private async deleteSnapshotFile(): Promise<void> {
    this.targetsCache = {};
    try {
      await vscode.workspace.fs.delete(this.snapshotFileUri, { recursive: false, useTrash: false });
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
        this.logger.info(`Failed to delete target file snapshot: ${error}`);
      }
    }
  }

  private isOldFormatSnapshot(value: unknown): value is TargetFileSnapshot {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const snapshot = value as Partial<TargetFileSnapshot>;
    return (
      typeof snapshot.uri === 'string' &&
      typeof snapshot.content === 'string' &&
      typeof snapshot.savedAt === 'number'
    );
  }

  private isValidTargetsMap(value: unknown): value is TargetsMap {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const map = value as Record<string, unknown>;
    return Object.values(map).every((item) => this.isValidSnapshot(item));
  }

  private isValidSnapshot(value: unknown): value is TargetFileSnapshot {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const snapshot = value as Partial<TargetFileSnapshot>;
    return (
      typeof snapshot.uri === 'string' &&
      typeof snapshot.content === 'string' &&
      typeof snapshot.savedAt === 'number'
    );
  }

  private migrateOldFormat(oldSnapshot: TargetFileSnapshot): TargetsMap {
    const uri = vscode.Uri.parse(oldSnapshot.uri);
    const key = this.getKeyForUri(uri);
    return {
      [key]: oldSnapshot,
    };
  }

  private getKeyForUri(uri: vscode.Uri): string {
    // 优先使用相对路径，无工作区时使用完整 URI
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const relative = vscode.workspace.asRelativePath(uri, false);
      if (relative && relative !== uri.fsPath) {
        return relative;
      }
    }
    return uri.toString();
  }

  private getLabelForUri(uri: vscode.Uri): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return uri.fsPath;
    }

    const relative = vscode.workspace.asRelativePath(uri, false);
    return relative || uri.fsPath;
  }
}
