import * as vscode from 'vscode';
import { TargetFileManager } from './targetFileManager';
import { SecretModeHandler } from './secretModeHandler';

type Node =
  | { kind: 'status'; label: string; description: string }
  | { kind: 'section'; label: string }
  | { kind: 'targetFile'; uri: string; label: string; description: string }
  | { kind: 'action'; label: string; description?: string; command: vscode.Command };

export class SidebarProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly targetFileManager: TargetFileManager,
    private readonly secretModeHandler: SecretModeHandler,
  ) {
    // 监听目标文件变化，自动刷新侧边栏
    targetFileManager.onDidChange(() => this.refresh());
    secretModeHandler.onDidChangeState(() => this.refresh());
    vscode.window.onDidChangeActiveTextEditor(() => this.refresh());
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (element.kind === 'status') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon('eye');
      item.contextValue = 'status';
      return item;
    }

    if (element.kind === 'section') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('files');
      item.contextValue = 'section';
      return item;
    }

    if (element.kind === 'targetFile') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon('file-code');
      item.contextValue = 'targetFile';
      item.tooltip = `Saved at: ${element.description}\nClick to open file`;
      item.command = {
        title: 'Open Target File',
        command: 'vscode.open',
        arguments: [vscode.Uri.parse(element.uri)],
      };
      item.resourceUri = vscode.Uri.parse(element.uri);
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.command = element.command;
    item.iconPath = new vscode.ThemeIcon('symbol-event');
    item.contextValue = 'action';
    return item;
  }

  getChildren(element?: Node): Node[] {
    if (element?.kind === 'section') {
      return this.getTargetFileNodes();
    }

    if (element) {
      return [];
    }

    const state = this.secretModeHandler.state;
    const nodes: Node[] = [
      {
        kind: 'status',
        label: state.active ? '秘密模式：开启' : '秘密模式：待机',
        description: state.active ? '当前模式：智能替换' : '点击下方按钮可切换',
      },
      {
        kind: 'section',
        label: '目标文件列表',
      },
    ];

    // 添加操作按钮
    nodes.push(
      {
        kind: 'action',
        label: '切换秘密模式',
        command: {
          title: '切换秘密模式',
          command: 'demotyper.toggleSecretMode',
        },
      },
      {
        kind: 'action',
        label: '恢复当前文件',
        command: {
          title: '恢复当前文件',
          command: 'demotyper.restoreCurrentFile',
        },
      },
      {
        kind: 'action',
        label: '跳转到下一个差异',
        command: {
          title: '跳转到下一个差异',
          command: 'demotyper.jumpToNextGap',
        },
      },
      {
        kind: 'action',
        label: '设置当前文件为目标',
        command: {
          title: '设置当前文件为目标',
          command: 'demotyper.setAsTargetFile',
        },
      },
      {
        kind: 'action',
        label: '清除当前文件目标',
        command: {
          title: '清除当前文件目标',
          command: 'demotyper.clearTargetFile',
        },
      },
      {
        kind: 'action',
        label: '清除所有目标文件',
        command: {
          title: '清除所有目标文件',
          command: 'demotyper.clearAllTargets',
        },
      },
    );

    return nodes;
  }

  private getTargetFileNodes(): Node[] {
    const targets = this.targetFileManager.getAllTargets();
    const entries = Object.entries(targets);

    if (entries.length === 0) {
      return [];
    }

    const currentEditorUri = vscode.window.activeTextEditor?.document.uri.toString();

    return entries
      .map(([key, snapshot]) => {
        const uri = vscode.Uri.parse(snapshot.uri);
        const savedTime = new Date(snapshot.savedAt).toLocaleString();
        const isCurrent = snapshot.uri === currentEditorUri;

        return {
          kind: 'targetFile' as const,
          uri: snapshot.uri,
          label: isCurrent ? `$(check) ${key}` : key,
          description: savedTime,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}
