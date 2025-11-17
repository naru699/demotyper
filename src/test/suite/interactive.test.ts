import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('Interactive Demo - 真实VS Code编辑器演示', () => {
  let tempDir: string;

  // 打字速度控制
  const CHAR_DELAY = 100; // 每个字符100ms
  const PAUSE_DELAY = 1500; // 暂停1.5秒
  const LONG_PAUSE = 3000; // 长暂停3秒

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // 在编辑器中模拟打字
  async function typeInEditor(editor: vscode.TextEditor, text: string): Promise<void> {
    for (const char of text) {
      await editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, char);
      });
      // 移动光标到插入位置之后
      const newPosition = editor.selection.active.translate(0, 1);
      editor.selection = new vscode.Selection(newPosition, newPosition);
      await delay(CHAR_DELAY);
    }
  }

  // 在指定位置插入文本
  async function insertAtPosition(
    editor: vscode.TextEditor,
    line: number,
    character: number,
    text: string,
  ): Promise<void> {
    const position = new vscode.Position(line, character);
    editor.selection = new vscode.Selection(position, position);

    // 让用户看到光标移动
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    await delay(500);

    // 逐字符输入
    for (const char of text) {
      await editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, char);
      });
      await delay(CHAR_DELAY);
    }
  }

  // 插入换行和缩进
  async function insertNewlineWithIndent(
    editor: vscode.TextEditor,
    line: number,
    character: number,
    indent: string,
  ): Promise<void> {
    const position = new vscode.Position(line, character);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    await delay(300);

    await editor.edit((editBuilder) => {
      editBuilder.insert(position, '\n' + indent);
    });
    await delay(CHAR_DELAY * 3);
  }

  suiteSetup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demotyper-interactive-'));
    console.log('\n🎭 交互式演示测试');
    console.log(`   临时目录: ${tempDir}`);
    console.log('\n⏰ 请观看VS Code编辑器窗口中的实时变化！\n');
  });

  suiteTeardown(async () => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('演示A: 在真实编辑器中填充挖空', async function () {
    this.timeout(120000); // 2分钟超时

    console.log('📺 演示A: 观看编辑器窗口 - 填充变量值');
    console.log('   请将注意力放在VS Code编辑器窗口上！\n');

    // 创建带挖空的文件
    const filePath = path.join(tempDir, 'demo_fill.cs');
    const initialContent = `// DemoTyper 演示 - 填充挖空
// 观看下面的变量值如何被自动填充

public class DroneConfig
{
    // 无人机数量
    public int droneCount = ;  // ← 看这里！

    // 飞行速度
    public float flySpeed = ;  // ← 看这里！

    // 无人机名称
    public string droneName = ;  // ← 看这里！

    // 是否启用
    public bool isEnabled = ;  // ← 看这里！
}
`;

    fs.writeFileSync(filePath, initialContent, 'utf8');

    // 打开文件
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    console.log('   ✓ 文件已打开，准备开始...');
    await delay(LONG_PAUSE);

    // 填充第一个值: droneCount = 4
    console.log('   → 正在填充: droneCount = 4');
    await insertAtPosition(editor, 6, 27, '4');
    console.log('   ✓ 完成: droneCount = 4');
    await delay(PAUSE_DELAY);

    // 填充第二个值: flySpeed = 15.5f
    console.log('   → 正在填充: flySpeed = 15.5f');
    await insertAtPosition(editor, 9, 26, '15.5f');
    console.log('   ✓ 完成: flySpeed = 15.5f');
    await delay(PAUSE_DELAY);

    // 填充第三个值: droneName = "Eagle"
    console.log('   → 正在填充: droneName = "Eagle"');
    await insertAtPosition(editor, 12, 28, '"Eagle"');
    console.log('   ✓ 完成: droneName = "Eagle"');
    await delay(PAUSE_DELAY);

    // 填充第四个值: isEnabled = true
    console.log('   → 正在填充: isEnabled = true');
    await insertAtPosition(editor, 15, 26, 'true');
    console.log('   ✓ 完成: isEnabled = true');
    await delay(PAUSE_DELAY);

    console.log('\n   🎉 演示A完成！所有挖空已填充');
    await delay(LONG_PAUSE);

    // 验证
    const finalText = editor.document.getText();
    assert.ok(finalText.includes('droneCount = 4;'), 'droneCount should be filled');
    assert.ok(finalText.includes('flySpeed = 15.5f;'), 'flySpeed should be filled');
    assert.ok(finalText.includes('droneName = "Eagle";'), 'droneName should be filled');
    assert.ok(finalText.includes('isEnabled = true;'), 'isEnabled should be filled');
  });

  test('演示B: 在真实编辑器中插入换行', async function () {
    this.timeout(120000);

    console.log('\n📺 演示B: 观看编辑器窗口 - 分离合并的语句');
    console.log('   请将注意力放在VS Code编辑器窗口上！\n');

    // 创建有合并行的文件
    const filePath = path.join(tempDir, 'demo_newline.cs');
    const initialContent = `// DemoTyper 演示 - 自动换行
// 观看合并的语句如何被分离到单独的行

public class DroneManager
{
    void Initialize()
    {
        // 下面一行有4个语句挤在一起，需要分离
        int a = 1;int b = 2;int c = 3;int d = 4;
    }

    void Setup()
    {
        // 下面一行有3个方法调用挤在一起
        CreateDrones();AssignTasks();StartPatrol();
    }
}
`;

    fs.writeFileSync(filePath, initialContent, 'utf8');

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    console.log('   ✓ 文件已打开，准备开始...');
    console.log('   观察第9行和第15行的合并语句');
    await delay(LONG_PAUSE);

    // 分离第9行的语句
    console.log('   → 正在分离第9行: int a = 1;int b = 2;int c = 3;int d = 4;');

    // 第一次换行: 在 "int a = 1;" 后
    console.log('     插入第1个换行...');
    await insertNewlineWithIndent(editor, 8, 18, '        ');
    await delay(PAUSE_DELAY);

    // 第二次换行: 在 "int b = 2;" 后
    console.log('     插入第2个换行...');
    await insertNewlineWithIndent(editor, 9, 18, '        ');
    await delay(PAUSE_DELAY);

    // 第三次换行: 在 "int c = 3;" 后
    console.log('     插入第3个换行...');
    await insertNewlineWithIndent(editor, 10, 18, '        ');
    await delay(PAUSE_DELAY);

    console.log('   ✓ 第9行分离完成！现在每个变量声明在单独的行');
    await delay(PAUSE_DELAY);

    // 分离方法调用（现在在第18行）
    console.log('   → 正在分离方法调用行...');

    // 第一次换行: 在 "CreateDrones();" 后
    console.log('     插入第1个换行...');
    await insertNewlineWithIndent(editor, 17, 22, '        ');
    await delay(PAUSE_DELAY);

    // 第二次换行: 在 "AssignTasks();" 后
    console.log('     插入第2个换行...');
    await insertNewlineWithIndent(editor, 18, 22, '        ');
    await delay(PAUSE_DELAY);

    console.log('   ✓ 方法调用分离完成！');
    await delay(PAUSE_DELAY);

    console.log('\n   🎉 演示B完成！所有合并的语句已分离');
    await delay(LONG_PAUSE);

    // 验证行数增加
    assert.ok(editor.document.lineCount > 17, 'Lines should have increased');
  });

  test('演示C: 复杂Unity代码补全', async function () {
    this.timeout(180000); // 3分钟超时

    console.log('\n📺 演示C: 观看编辑器窗口 - 复杂代码补全');
    console.log('   请将注意力放在VS Code编辑器窗口上！\n');

    const filePath = path.join(tempDir, 'demo_unity.cs');
    const initialContent = `using UnityEngine;

// DemoTyper 演示 - Unity C# 复杂补全
public class PatrolManager : MonoBehaviour
{
    [Header("配置")]
    public GameObject dronePrefab;
    public float patrolRadius = ;  // ← 填充半径
    public int maxDrones = ;       // ← 填充数量

    [Header("颜色设置")]
    private Color droneColor = new Color(, , , );  // ← 填充RGBA

    private DroneController[] drones;

    void Start()
    {
        // 下面的初始化代码需要分离
        InitializeSystem();CreateDrones();AssignPatrolPaths();StartPatrol();
    }

    void InitializeSystem()
    {
        drones = new DroneController[];  // ← 填充数组大小
        Debug.Log();  // ← 填充日志消息
    }
}
`;

    fs.writeFileSync(filePath, initialContent, 'utf8');

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    console.log('   ✓ Unity C# 文件已打开');
    console.log('   这个演示将展示:');
    console.log('   - 填充数值 (float, int)');
    console.log('   - 填充Color构造函数参数');
    console.log('   - 分离合并的方法调用');
    console.log('   - 填充数组大小和日志消息\n');
    await delay(LONG_PAUSE);

    // 填充 patrolRadius
    console.log('   → 填充: patrolRadius = 50.0f');
    await insertAtPosition(editor, 7, 30, '50.0f');
    console.log('   ✓ patrolRadius = 50.0f');
    await delay(PAUSE_DELAY);

    // 填充 maxDrones
    console.log('   → 填充: maxDrones = 4');
    await insertAtPosition(editor, 8, 23, '4');
    console.log('   ✓ maxDrones = 4');
    await delay(PAUSE_DELAY);

    // 填充 Color 参数
    console.log('   → 填充: Color(1f, 0.8f, 0.2f, 1f)');
    await insertAtPosition(editor, 11, 40, '1f');
    await delay(300);
    await insertAtPosition(editor, 11, 44, '0.8f');
    await delay(300);
    await insertAtPosition(editor, 11, 50, '0.2f');
    await delay(300);
    await insertAtPosition(editor, 11, 56, '1f');
    console.log('   ✓ droneColor = new Color(1f, 0.8f, 0.2f, 1f)');
    await delay(PAUSE_DELAY);

    // 分离 Start() 中的方法调用
    console.log('   → 分离Start()中的4个方法调用...');
    await insertNewlineWithIndent(editor, 18, 26, '        ');
    await delay(800);
    await insertNewlineWithIndent(editor, 19, 22, '        ');
    await delay(800);
    await insertNewlineWithIndent(editor, 20, 26, '        ');
    console.log('   ✓ 方法调用已分离到单独的行');
    await delay(PAUSE_DELAY);

    // 填充数组大小
    console.log('   → 填充: new DroneController[maxDrones]');
    await insertAtPosition(editor, 25, 38, 'maxDrones');
    console.log('   ✓ drones = new DroneController[maxDrones]');
    await delay(PAUSE_DELAY);

    // 填充 Debug.Log
    console.log('   → 填充: Debug.Log("巡逻系统初始化完成")');
    await insertAtPosition(editor, 26, 18, '"巡逻系统初始化完成"');
    console.log('   ✓ Debug.Log("巡逻系统初始化完成")');
    await delay(PAUSE_DELAY);

    console.log('\n   🎉 演示C完成！复杂Unity代码补全成功');
    console.log('   观察编辑器中的最终代码结构\n');
    await delay(LONG_PAUSE * 2);

    // 验证
    const finalText = editor.document.getText();
    assert.ok(finalText.includes('patrolRadius = 50.0f;'), 'patrolRadius should be filled');
    assert.ok(finalText.includes('maxDrones = 4;'), 'maxDrones should be filled');
    assert.ok(finalText.includes('DroneController[maxDrones]'), 'array size should be filled');
  });
});
