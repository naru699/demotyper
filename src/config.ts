import * as vscode from 'vscode';

export interface DemoTyperConfig {
  enableLogging: boolean;
  muteGuidance: boolean;
}

export class ConfigManager implements vscode.Disposable {
  private current: DemoTyperConfig;
  private readonly emitter = new vscode.EventEmitter<DemoTyperConfig>();
  private readonly subscription: vscode.Disposable;

  constructor() {
    this.current = this.readConfig();
    this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('demotyper')) {
        this.current = this.readConfig();
        this.emitter.fire(this.current);
      }
    });
  }

  get value(): DemoTyperConfig {
    return this.current;
  }

  onDidChange(listener: (config: DemoTyperConfig) => void): vscode.Disposable {
    return this.emitter.event(listener);
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }

  private readConfig(): DemoTyperConfig {
    const config = vscode.workspace.getConfiguration('demotyper');
    return {
      enableLogging: config.get<boolean>('enableLogging', false),
      muteGuidance: config.get<boolean>('notifications.muteGuidance', false),
    };
  }
}
