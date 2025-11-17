import * as assert from 'assert';
import * as vscode from 'vscode';
import { SmartReplaceHandler } from '../../smartReplaceHandler';
import { UndoFriendlyEditOptions } from '../../types';
import { Logger } from '../../logger';
import { NotificationManager } from '../../notificationManager';
import { TargetFileManager } from '../../targetFileManager';

suite('SmartReplace loop detection', () => {
  /**
   * 构造一个最小的 SmartReplaceHandler，依赖项全部使用空实现。
   */
  function createHandler(warningSink: string[]): SmartReplaceHandler {
    const fakeTargetManager = {
      readTargetContent: async () => '',
    } as unknown as TargetFileManager;

    const silentLogger = {
      info: () => {},
      dispose: () => {},
    } as unknown as Logger;

    const notifications = {
      info: async () => undefined,
      error: async () => undefined,
      warning: async (message: string) => {
        warningSink.push(message);
        return undefined;
      },
    } as unknown as NotificationManager;

    return new SmartReplaceHandler(fakeTargetManager, silentLogger, notifications);
  }

  test('stops after repeated inserts at the same offset', async () => {
    const warnings: string[] = [];
    const handler = createHandler(warnings);

    const document = await vscode.workspace.openTextDocument({ content: '', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(document);

    const insertAt = (handler as any).insertAt.bind(handler) as (
      editor: vscode.TextEditor,
      offset: number,
      text: string,
      editOptions: UndoFriendlyEditOptions,
    ) => Promise<boolean>;

    const editOptions: UndoFriendlyEditOptions = { undoStopBefore: false, undoStopAfter: false };
    const textToInsert = '\n    ';

    try {
      // 前三次插入允许通过
      for (let attempt = 1; attempt <= 3; attempt++) {
        const result = await insertAt(editor, 0, textToInsert, editOptions);
        assert.strictEqual(result, true, `Attempt ${attempt} should succeed`);
      }

      const textBeforeGuard = document.getText();

      // 第四次重复插入应该被阻止
      const blocked = await insertAt(editor, 0, textToInsert, editOptions);
      assert.strictEqual(blocked, false, 'Guard should block the fourth identical insert');

      const textAfterGuard = document.getText();
      assert.strictEqual(
        textAfterGuard,
        textBeforeGuard,
        'Document content should remain unchanged when the guard blocks the edit',
      );

      assert.strictEqual(warnings.length, 1, 'A warning should be shown when repeated insert is blocked');
      assert.ok(
        warnings[0]?.includes('死循环'),
        'Warning message should mention the infinite loop guard',
      );
    } finally {
      handler.reset();
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });
});
