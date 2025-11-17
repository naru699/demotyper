import * as vscode from 'vscode';

export class Logger {
  private readonly channel = vscode.window.createOutputChannel('DemoTyper');

  constructor(private readonly isEnabled: () => boolean) {}

  info(message: string): void {
    if (!this.isEnabled()) {
      return;
    }
    const timestamp = new Date().toISOString();
    this.channel.appendLine(`[${timestamp}] ${message}`);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
