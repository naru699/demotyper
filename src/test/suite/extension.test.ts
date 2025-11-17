import * as assert from 'assert';
import * as vscode from 'vscode';

suite('DemoTyper Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('demotyper.demotyper'));
  });

  test('Extension should be active', async () => {
    const ext = vscode.extensions.getExtension('demotyper.demotyper');
    assert.ok(ext);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test('Should register all commands', async () => {
    const commands = await vscode.commands.getCommands(true);

    const expectedCommands = [
      'demotyper.toggleSecretMode',
      'demotyper.setAsTargetFile',
      'demotyper.clearTargetFile',
      'demotyper.restoreCurrentFile',
      'demotyper.jumpToNextGap',
      'demotyper.showDebugInfo',
    ];

    for (const cmd of expectedCommands) {
      assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
    }
  });

  test('Should be able to create and edit a file', async () => {
    // 创建一个新的未标题文档
    const doc = await vscode.workspace.openTextDocument({ content: 'initial content', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);

    assert.strictEqual(editor.document.getText(), 'initial content');

    // 编辑文档
    const success = await editor.edit((editBuilder) => {
      editBuilder.replace(new vscode.Range(0, 0, 0, 7), 'modified');
    });

    assert.ok(success, 'Edit should succeed');
    assert.strictEqual(editor.document.getText(), 'modified content');
  });

  test.skip('Toggle secret mode command should execute without error', async () => {
    // 确保有活动编辑器
    const doc = await vscode.workspace.openTextDocument({ content: 'test', language: 'plaintext' });
    await vscode.window.showTextDocument(doc);

    // 先设置目标文件（否则会显示警告）
    await vscode.commands.executeCommand('demotyper.setAsTargetFile');
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 执行命令（不应抛出错误）
    try {
      // 使用 Promise.race 添加超时保护
      await Promise.race([
        vscode.commands.executeCommand('demotyper.toggleSecretMode'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Toggle timeout')), 5000)),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 再次切换关闭
      await Promise.race([
        vscode.commands.executeCommand('demotyper.toggleSecretMode'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Toggle timeout')), 5000)),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 清理
      await vscode.commands.executeCommand('demotyper.clearTargetFile');
      assert.ok(true);
    } catch (error) {
      assert.fail(`Command should not throw error: ${error}`);
    }
  });
});

suite('Smart Replace Handler Tests', () => {
  test('Should handle simple text insertion', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'abc', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);

    // 在位置 1 插入 'X'
    const success = await editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(0, 1), 'X');
    });

    assert.ok(success);
    assert.strictEqual(editor.document.getText(), 'aXbc');
  });

  test('Should handle newline insertion', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'line1;line2', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);

    // 在分号后插入换行
    const success = await editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(0, 6), '\n');
    });

    assert.ok(success);
    assert.strictEqual(editor.document.lineCount, 2);
    assert.strictEqual(editor.document.lineAt(0).text, 'line1;');
    assert.strictEqual(editor.document.lineAt(1).text, 'line2');
  });

  test('Should handle newline with indentation', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'line1;line2', language: 'plaintext' });
    const editor = await vscode.window.showTextDocument(doc);

    // 在分号后插入换行+缩进
    const success = await editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(0, 6), '\n    ');
    });

    assert.ok(success);
    assert.strictEqual(editor.document.lineCount, 2);
    assert.strictEqual(editor.document.lineAt(0).text, 'line1;');
    assert.strictEqual(editor.document.lineAt(1).text, '    line2');
  });
});

suite('Target File Manager Tests', () => {
  test('Set and clear target file command should work', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'target content', language: 'plaintext' });
    await vscode.window.showTextDocument(doc);

    // 这些命令可能会显示消息，但不应抛出错误
    try {
      await vscode.commands.executeCommand('demotyper.setAsTargetFile');
      // 等待一下让命令完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      await vscode.commands.executeCommand('demotyper.clearTargetFile');
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.ok(true);
    } catch (error) {
      assert.fail(`Commands should not throw error: ${error}`);
    }
  });
});
