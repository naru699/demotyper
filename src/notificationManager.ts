import * as vscode from 'vscode';
import { ConfigManager } from './config';

export class NotificationManager {
  constructor(private readonly configManager: ConfigManager) {}

  async info(message: string, ...items: string[]): Promise<string | undefined> {
    if (this.configManager.value.muteGuidance) {
      return undefined;
    }
    if (items.length > 0) {
      return vscode.window.showInformationMessage(message, ...items);
    }
    return vscode.window.showInformationMessage(message);
  }

  async warning(message: string, ...items: string[]): Promise<string | undefined> {
    if (this.configManager.value.muteGuidance) {
      return undefined;
    }
    if (items.length > 0) {
      return vscode.window.showWarningMessage(message, ...items);
    }
    return vscode.window.showWarningMessage(message);
  }

  async error(message: string, ...items: string[]): Promise<string | undefined> {
    if (this.configManager.value.muteGuidance) {
      return undefined;
    }
    if (items.length > 0) {
      return vscode.window.showErrorMessage(message, ...items);
    }
    return vscode.window.showErrorMessage(message);
  }
}
