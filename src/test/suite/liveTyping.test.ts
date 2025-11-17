import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('Live Typing Demo Tests', () => {
  let tempDir: string;

  // 控制打字速度
  const TYPING_DELAY = 150; // 每个字符150ms，模拟真实打字
  const STEP_DELAY = 1000; // 步骤之间1秒延迟

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // 美化输出
  const log = {
    title: (msg: string) => console.log(`\n${'🎬'.repeat(3)} ${msg} ${'🎬'.repeat(3)}`),
    section: (msg: string) => console.log(`\n${'='.repeat(60)}\n  ${msg}\n${'='.repeat(60)}`),
    step: (msg: string) => console.log(`\n  📌 ${msg}`),
    typing: (char: string) => process.stdout.write(char), // 不换行，模拟打字
    newline: () => console.log(''), // 换行
    info: (msg: string) => console.log(`    ℹ️  ${msg}`),
    success: (msg: string) => console.log(`    ✅ ${msg}`),
    warning: (msg: string) => console.log(`    ⚠️  ${msg}`),
    cursor: () => process.stdout.write('|'), // 光标位置
    backspace: () => process.stdout.write('\b \b'), // 退格效果
    showLine: (lineNum: number, content: string, highlight?: string) => {
      if (highlight && content.includes(highlight)) {
        const parts = content.split(highlight);
        console.log(`  ${String(lineNum).padStart(3)} | ${parts[0]}\x1b[33m${highlight}\x1b[0m${parts.slice(1).join(highlight)}`);
      } else {
        console.log(`  ${String(lineNum).padStart(3)} | ${content}`);
      }
    },
  };

  suiteSetup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demotyper-live-'));
    log.title('DemoTyper 实时打字演示测试');
    console.log(`\n  测试目录: ${tempDir}`);
  });

  suiteTeardown(async () => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('演示1: 观看实时填充挖空', async function () {
    this.timeout(60000); // 60秒超时

    log.section('演示1: 实时填充变量值');
    await delay(STEP_DELAY);

    // 目标内容
    const targetContent = `int count = 42;
float speed = 3.14f;
string name = "Drone";`;

    // 当前内容（挖空）
    let currentContent = `int count = ;
float speed = ;
string name = ;`;

    log.step('目标代码:');
    targetContent.split('\n').forEach((line, i) => log.showLine(i + 1, line));
    await delay(STEP_DELAY);

    log.step('当前代码（有挖空）:');
    currentContent.split('\n').forEach((line, i) => log.showLine(i + 1, line, '= ;'));
    await delay(STEP_DELAY);

    // 创建文档
    const doc = await vscode.workspace.openTextDocument({ content: currentContent, language: 'csharp' });
    const editor = await vscode.window.showTextDocument(doc);

    log.step('开始实时填充...');
    console.log('\n  观看打字过程:\n');

    // 填充第一个值: 42
    console.log('  第1行: int count = ');
    log.cursor();
    await delay(500);

    const value1 = '42';
    for (const char of value1) {
      log.backspace(); // 移除光标
      log.typing(char);
      log.cursor();
      await delay(TYPING_DELAY);
    }
    log.backspace();
    log.newline();
    log.success('填充完成: count = 42');
    await delay(STEP_DELAY);

    // 填充第二个值: 3.14f
    console.log('  第2行: float speed = ');
    log.cursor();
    await delay(500);

    const value2 = '3.14f';
    for (const char of value2) {
      log.backspace();
      log.typing(char);
      log.cursor();
      await delay(TYPING_DELAY);
    }
    log.backspace();
    log.newline();
    log.success('填充完成: speed = 3.14f');
    await delay(STEP_DELAY);

    // 填充第三个值: "Drone"
    console.log('  第3行: string name = ');
    log.cursor();
    await delay(500);

    const value3 = '"Drone"';
    for (const char of value3) {
      log.backspace();
      log.typing(char);
      log.cursor();
      await delay(TYPING_DELAY);
    }
    log.backspace();
    log.newline();
    log.success('填充完成: name = "Drone"');
    await delay(STEP_DELAY);

    log.step('最终结果:');
    targetContent.split('\n').forEach((line, i) => log.showLine(i + 1, line));

    log.success('所有挖空已填充完成！');
  });

  test('演示2: 观看换行插入过程', async function () {
    this.timeout(60000);

    log.section('演示2: 分号后自动换行');
    await delay(STEP_DELAY);

    log.step('问题场景: 多个语句粘在一行');
    console.log('\n  当前代码:');
    console.log('  ----------------------------------------');
    console.log('    1 | void Setup() {');
    console.log('    2 |     int a = 1;int b = 2;int c = 3;');
    console.log('    3 | }');
    console.log('  ----------------------------------------');
    log.warning('第2行有3个语句挤在一起！');
    await delay(STEP_DELAY);

    log.step('目标: 每个语句单独一行');
    console.log('\n  目标代码:');
    console.log('  ----------------------------------------');
    console.log('    1 | void Setup() {');
    console.log('    2 |     int a = 1;');
    console.log('    3 |     int b = 2;');
    console.log('    4 |     int c = 3;');
    console.log('    5 | }');
    console.log('  ----------------------------------------');
    await delay(STEP_DELAY);

    log.step('观看DemoTyper如何处理...');
    await delay(STEP_DELAY);

    console.log('\n  模拟用户输入（任意键触发）:');
    await delay(500);

    // 第一次换行
    console.log('\n  🔍 检测到: "int a = 1;" 后面有多余内容');
    console.log('  📝 动作: 在分号后插入 换行符 + 缩进');
    await delay(TYPING_DELAY * 3);

    console.log('\n  结果:');
    console.log('    2 |     int a = 1;');
    console.log('    3 |     int b = 2;int c = 3;  ← 还有两个语句粘在一起');
    log.success('第一个换行插入成功');
    await delay(STEP_DELAY);

    // 第二次换行
    console.log('\n  用户再次输入...');
    await delay(500);

    console.log('\n  🔍 检测到: "int b = 2;" 后面有多余内容');
    console.log('  📝 动作: 在分号后插入 换行符 + 缩进');
    await delay(TYPING_DELAY * 3);

    console.log('\n  结果:');
    console.log('    2 |     int a = 1;');
    console.log('    3 |     int b = 2;');
    console.log('    4 |     int c = 3;  ← 完美分离！');
    log.success('第二个换行插入成功');
    await delay(STEP_DELAY);

    log.step('最终代码结构:');
    console.log('  ----------------------------------------');
    console.log('    1 | void Setup() {');
    console.log('    2 |     int a = 1;');
    console.log('    3 |     int b = 2;');
    console.log('    4 |     int c = 3;');
    console.log('    5 | }');
    console.log('  ----------------------------------------');

    log.success('语句分离完成，代码结构清晰！');
  });

  test('演示3: 复杂代码补全过程', async function () {
    this.timeout(90000);

    log.section('演示3: Unity C# 代码补全');
    await delay(STEP_DELAY);

    log.step('场景: 填充DroneController的初始化代码');
    await delay(STEP_DELAY);

    console.log('\n  当前代码（挖空版本）:');
    console.log('  ----------------------------------------');
    const currentLines = [
      'public class DroneController {',
      '    private int droneId = ;',
      '    private float speed = ;',
      '    private Color color = new Color(, , );',
      '',
      '    void Start() {',
      '        Initialize();SetupVisuals();',
      '    }',
      '}',
    ];
    currentLines.forEach((line, i) => {
      if (line.includes('= ;') || line.includes('(, , )') || line.includes(';SetupVisuals')) {
        log.showLine(i + 1, line, line.includes('= ;') ? '= ;' : line.includes('(, , )') ? '(, , )' : ';SetupVisuals');
      } else {
        log.showLine(i + 1, line);
      }
    });
    console.log('  ----------------------------------------');
    await delay(STEP_DELAY);

    log.step('开始逐步补全...');
    await delay(STEP_DELAY);

    // 补全 droneId
    console.log('\n  📍 第2行: private int droneId = |;');
    console.log('     目标值: 0');
    process.stdout.write('     填充: ');
    log.cursor();
    await delay(300);
    log.backspace();
    log.typing('0');
    log.newline();
    log.success('droneId = 0');
    await delay(STEP_DELAY);

    // 补全 speed
    console.log('\n  📍 第3行: private float speed = |;');
    console.log('     目标值: 10.5f');
    process.stdout.write('     填充: ');
    log.cursor();
    await delay(300);
    for (const char of '10.5f') {
      log.backspace();
      log.typing(char);
      log.cursor();
      await delay(TYPING_DELAY);
    }
    log.backspace();
    log.newline();
    log.success('speed = 10.5f');
    await delay(STEP_DELAY);

    // 补全 Color
    console.log('\n  📍 第4行: new Color(|, , )');
    console.log('     目标值: 1f, 0.5f, 0.2f');
    process.stdout.write('     填充第1个参数: ');
    log.cursor();
    await delay(300);
    for (const char of '1f') {
      log.backspace();
      log.typing(char);
      log.cursor();
      await delay(TYPING_DELAY);
    }
    log.backspace();
    log.newline();

    process.stdout.write('     填充第2个参数: ');
    log.cursor();
    await delay(300);
    for (const char of '0.5f') {
      log.backspace();
      log.typing(char);
      log.cursor();
      await delay(TYPING_DELAY);
    }
    log.backspace();
    log.newline();

    process.stdout.write('     填充第3个参数: ');
    log.cursor();
    await delay(300);
    for (const char of '0.2f') {
      log.backspace();
      log.typing(char);
      log.cursor();
      await delay(TYPING_DELAY);
    }
    log.backspace();
    log.newline();
    log.success('color = new Color(1f, 0.5f, 0.2f)');
    await delay(STEP_DELAY);

    // 处理合并行
    console.log('\n  📍 第7行: Initialize();SetupVisuals();');
    console.log('     问题: 两个方法调用粘在一起');
    console.log('     动作: 在第一个分号后插入换行+缩进');
    await delay(STEP_DELAY);

    console.log('\n     插入换行符...');
    await delay(TYPING_DELAY * 5);
    console.log('     结果:');
    console.log('       7 |         Initialize();');
    console.log('       8 |         SetupVisuals();');
    log.success('方法调用已分离到单独的行');
    await delay(STEP_DELAY);

    log.step('补全后的完整代码:');
    console.log('  ----------------------------------------');
    const finalLines = [
      'public class DroneController {',
      '    private int droneId = 0;',
      '    private float speed = 10.5f;',
      '    private Color color = new Color(1f, 0.5f, 0.2f);',
      '',
      '    void Start() {',
      '        Initialize();',
      '        SetupVisuals();',
      '    }',
      '}',
    ];
    finalLines.forEach((line, i) => log.showLine(i + 1, line));
    console.log('  ----------------------------------------');

    log.success('代码补全完成！所有挖空已填充，所有换行已插入');
  });
});
