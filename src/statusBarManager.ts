import * as vscode from 'vscode';
import { SecretModeState } from './types';
import { TargetFileManager } from './targetFileManager';

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly targetFileManager: TargetFileManager) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'demotyper.toggleSecretMode';
    this.item.tooltip = 'Toggle DemoTyper Secret Mode';
    this.update({ active: false });
    this.item.show();
  }

  update(state: SecretModeState): void {
    const suffix = state.active ? `Secret (Smart • ${this.getCurrentFileLabel()})` : 'Ready';

    this.item.text = `$(keyboard) DemoTyper: ${suffix}`;
  }

  private getCurrentFileLabel(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return 'None';
    }
    return this.targetFileManager.getTargetFileLabel(editor.document.uri);
  }

  dispose(): void {
    this.item.dispose();
  }
}
