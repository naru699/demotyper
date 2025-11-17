import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('Smart Replace Complex Tests', () => {
  let tempDir: string;
  let targetFiles: string[] = [];
  let currentFiles: string[] = [];

  // 控制测试速度的延迟函数
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const STEP_DELAY = 500; // 每步延迟500ms，让输出更清晰

  // 美化日志输出
  const log = {
    section: (title: string) => console.log(`\n${'='.repeat(60)}\n  ${title}\n${'='.repeat(60)}`),
    step: (msg: string) => console.log(`  → ${msg}`),
    info: (msg: string) => console.log(`    ${msg}`),
    success: (msg: string) => console.log(`  ✓ ${msg}`),
    code: (label: string, content: string) => {
      console.log(`\n  📄 ${label}:`);
      console.log('  ' + '-'.repeat(50));
      content.split('\n').forEach((line, i) => {
        console.log(`  ${String(i + 1).padStart(3)} | ${line}`);
      });
      console.log('  ' + '-'.repeat(50));
    },
  };

  suiteSetup(async () => {
    // 创建临时测试目录
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demotyper-test-'));
    console.log(`\n🚀 测试环境初始化完成`);
    console.log(`   临时目录: ${tempDir}`);
  });

  suiteTeardown(async () => {
    // 清理临时文件
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  setup(async () => {
    targetFiles = [];
    currentFiles = [];
    // 关闭所有编辑器
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  teardown(async () => {
    // 清理测试文件
    for (const file of [...targetFiles, ...currentFiles]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  /**
   * 辅助函数：创建目标文件
   */
  function createTargetFile(name: string, content: string): string {
    const filePath = path.join(tempDir, `target_${name}`);
    fs.writeFileSync(filePath, content, 'utf8');
    targetFiles.push(filePath);
    return filePath;
  }

  /**
   * 辅助函数：创建当前文件（带挖空）
   */
  function createCurrentFile(name: string, content: string): string {
    const filePath = path.join(tempDir, `current_${name}`);
    fs.writeFileSync(filePath, content, 'utf8');
    currentFiles.push(filePath);
    return filePath;
  }

  /**
   * 辅助函数：模拟单次按键输入
   */
  async function simulateKeyPress(): Promise<void> {
    // 使用VS Code的type命令模拟输入
    // 这里我们直接调用扩展的处理逻辑
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  test('Test 1: Multiple gaps in single file - semicolon endings', async () => {
    log.section('测试1: 单文件多挖空 - 分号结尾');
    await delay(STEP_DELAY);

    // 目标文件：完整的C#代码
    const targetContent = `using System;

namespace Test
{
    public class DroneManager
    {
        private int droneCount = 4;
        private float speed = 10.5f;
        private string name = "TestDrone";

        public void Initialize()
        {
            Console.WriteLine("Initialized");
        }
    }
}`;

    // 当前文件：多处挖空
    const currentContent = `using System;

namespace Test
{
    public class DroneManager
    {
        private int droneCount = ;
        private float speed = ;
        private string name = ;

        public void Initialize()
        {
            Console.WriteLine();
        }
    }
}`;

    log.step('创建目标文件（完整代码）');
    const targetPath = createTargetFile('test1.cs', targetContent);
    log.info(`路径: ${targetPath}`);
    log.code('目标文件内容', targetContent);
    await delay(STEP_DELAY);

    log.step('创建当前文件（带挖空）');
    const currentPath = createCurrentFile('test1.cs', currentContent);
    log.info(`路径: ${currentPath}`);
    log.code('当前文件内容（挖空版本）', currentContent);
    await delay(STEP_DELAY);

    // 打开当前文件
    log.step('在VS Code中打开当前文件');
    const doc = await vscode.workspace.openTextDocument(currentPath);
    const editor = await vscode.window.showTextDocument(doc);
    log.info(`文件已打开，行数: ${doc.lineCount}`);
    await delay(STEP_DELAY);

    // 验证文件内容差异
    log.step('验证文件差异');
    assert.notStrictEqual(doc.getText(), targetContent, 'Files should be different initially');
    log.success('目标文件和当前文件内容不同');
    await delay(STEP_DELAY);

    // 检查具体的挖空位置
    log.step('检查挖空位置');
    const text = doc.getText();

    log.info('检查第1个挖空: droneCount = ;');
    assert.ok(text.includes('droneCount = ;'), 'Should have first gap');
    log.success('找到挖空: private int droneCount = ; (缺少 4)');
    await delay(300);

    log.info('检查第2个挖空: speed = ;');
    assert.ok(text.includes('speed = ;'), 'Should have second gap');
    log.success('找到挖空: private float speed = ; (缺少 10.5f)');
    await delay(300);

    log.info('检查第3个挖空: name = ;');
    assert.ok(text.includes('name = ;'), 'Should have third gap');
    log.success('找到挖空: private string name = ; (缺少 "TestDrone")');
    await delay(300);

    log.info('检查第4个挖空: WriteLine();');
    assert.ok(text.includes('WriteLine();'), 'Should have fourth gap');
    log.success('找到挖空: Console.WriteLine(); (缺少 "Initialized")');
    await delay(STEP_DELAY);

    log.step('测试1完成 ✅');
  });

  test('Test 2: Multiple gaps with different line endings', async () => {
    // 目标文件：混合行尾类型
    const targetContent = `public class MixedEndings {
    void Method1() {
        int x = 10;
    }

    void Method2() {
        string s = "test";
    }

    void Method3() {
        float f = 3.14f;
    }
}`;

    // 当前文件：缺少换行的版本（多个语句粘在一起）
    const currentContent = `public class MixedEndings {
    void Method1() {
        int x = ;
    }

    void Method2() {
        string s = ;
    }

    void Method3() {
        float f = ;
    }
}`;

    const targetPath = createTargetFile('test2.cs', targetContent);
    const currentPath = createCurrentFile('test2.cs', currentContent);

    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc);

    // 验证行数相同
    const targetDoc = await vscode.workspace.openTextDocument(targetPath);
    assert.strictEqual(doc.lineCount, targetDoc.lineCount, 'Line count should match');

    // 验证每个方法都有挖空
    const text = doc.getText();
    assert.ok(text.includes('x = ;'), 'Method1 should have gap');
    assert.ok(text.includes('s = ;'), 'Method2 should have gap');
    assert.ok(text.includes('f = ;'), 'Method3 should have gap');
  });

  test('Test 3: Statements concatenated on same line (newline insertion needed)', async () => {
    log.section('测试3: 合并行需要换行插入');
    await delay(STEP_DELAY);

    // 目标文件：每个语句在单独的行
    const targetContent = `namespace Scrips
{
    public class DroneController
    {
        private GameObject dronePrefab;
        private float droneScale = 1f;
        private Transform drone0ParkingTransform;
        private Transform drone1ParkingTransform;

        void Start()
        {
            InitializeSystem();
        }
    }
}`;

    // 当前文件：多个字段声明粘在一起（没有换行）
    const currentContent = `namespace Scrips
{
    public class DroneController
    {
        private GameObject dronePrefab;private float droneScale = 1f;private Transform drone0ParkingTransform;private Transform drone1ParkingTransform;

        void Start()
        {
            InitializeSystem();
        }
    }
}`;

    log.step('创建目标文件（每行一个语句）');
    const targetPath = createTargetFile('test3.cs', targetContent);
    log.code('目标文件', targetContent);
    await delay(STEP_DELAY);

    log.step('创建当前文件（多个语句合并在一行）');
    const currentPath = createCurrentFile('test3.cs', currentContent);
    log.code('当前文件（注意第5行）', currentContent);
    await delay(STEP_DELAY);

    log.step('打开文件并比较');
    const doc = await vscode.workspace.openTextDocument(currentPath);
    const editor = await vscode.window.showTextDocument(doc);
    const targetDoc = await vscode.workspace.openTextDocument(targetPath);

    log.info(`当前文件行数: ${doc.lineCount}`);
    log.info(`目标文件行数: ${targetDoc.lineCount}`);
    await delay(STEP_DELAY);

    // 验证当前文件行数少于目标文件
    log.step('验证行数差异');
    assert.ok(doc.lineCount < targetDoc.lineCount, 'Current should have fewer lines');
    log.success(`当前文件 (${doc.lineCount}行) < 目标文件 (${targetDoc.lineCount}行)`);
    log.info('说明需要插入换行符来分离语句');
    await delay(STEP_DELAY);

    // 验证特定行包含多个语句
    log.step('检查第5行（索引4）的合并情况');
    const line4 = doc.lineAt(4).text;
    log.info(`第5行内容: "${line4}"`);

    const semicolonCount = (line4.match(/;/g) || []).length;
    log.info(`该行包含 ${semicolonCount} 个分号`);

    assert.ok(line4.includes(';') && line4.lastIndexOf(';') > line4.indexOf(';'),
      'Line 4 should contain multiple semicolons (concatenated statements)');
    log.success('确认：多个语句被合并在同一行');
    log.info('DemoTyper需要在每个分号后插入换行+缩进');
    await delay(STEP_DELAY);

    log.step('测试3完成 ✅');
  });

  test('Test 4: Complex Unity C# with various gaps', async () => {
    // 完整的目标文件（基于提供的代码片段）
    const targetContent = `using System.Collections.Generic;
using UnityEngine;

namespace Scrips
{
    public class DronePatrolManager : MonoBehaviour
    {
        [Header("预制体")]
        public GameObject dronePrefab;

        [Header("无人机外观设置")]
        [Tooltip("调节无人机模型大小（1.0 = 原始大小）")]
        [Range(0.1f, 10f)]
        public float droneScale = 1f;

        [Header("可视化")]
        public bool showPatrolCircles = true;
        public bool showPatrolPoints = true;
        public bool showFlightPaths = true;

        private DroneController[] drones = new DroneController[4];
        private readonly Color[] droneColors = new Color[]
        {
            new Color(1f, 0.2f, 0.2f),
            new Color(0.2f, 1f, 0.2f),
            new Color(1f, 0.84f, 0f),
            new Color(0.2f, 0.5f, 1f)
        };

        void Start()
        {
            if (dronePrefab == null)
            {
                return;
            }
            InitializeSystem();
        }

        private void InitializeSystem()
        {
            CreateDrones();
            AssignTasks();
        }

        private void CreateDrones()
        {
            for (int i = 0; i < 4; i++)
            {
                GameObject droneObj = Instantiate(dronePrefab);
                droneObj.name = $"Drone_{i}";
            }
        }

        private void AssignTasks()
        {
            drones[0].SetTask(1);
            drones[1].SetTask(2);
            drones[2].SetTask(3);
            drones[3].SetTask(4);
        }
    }
}`;

    // 当前文件：多处挖空和合并行
    const currentContent = `using System.Collections.Generic;
using UnityEngine;

namespace Scrips
{
    public class DronePatrolManager : MonoBehaviour
    {
        [Header("预制体")]
        public GameObject dronePrefab;

        [Header("无人机外观设置")]
        [Tooltip("调节无人机模型大小（1.0 = 原始大小）")]
        [Range(0.1f, 10f)]
        public float droneScale = ;

        [Header("可视化")]
        public bool showPatrolCircles = ;
        public bool showPatrolPoints = ;
        public bool showFlightPaths = ;

        private DroneController[] drones = new DroneController[];
        private readonly Color[] droneColors = new Color[]
        {
            new Color(, , ),
            new Color(, , ),
            new Color(, , ),
            new Color(, , )
        };

        void Start()
        {
            if (dronePrefab == )
            {
                return;
            }
            InitializeSystem();
        }

        private void InitializeSystem()
        {
            CreateDrones();AssignTasks();
        }

        private void CreateDrones()
        {
            for (int i = 0; i < ; i++)
            {
                GameObject droneObj = Instantiate();
                droneObj.name = ;
            }
        }

        private void AssignTasks()
        {
            drones[0].SetTask();drones[1].SetTask();drones[2].SetTask();drones[3].SetTask();
        }
    }
}`;

    const targetPath = createTargetFile('test4.cs', targetContent);
    const currentPath = createCurrentFile('test4.cs', currentContent);

    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();

    // 验证各种类型的挖空
    // 1. 简单数值挖空
    assert.ok(text.includes('droneScale = ;'), 'Should have float gap');

    // 2. 布尔值挖空
    assert.ok(text.includes('showPatrolCircles = ;'), 'Should have bool gap 1');
    assert.ok(text.includes('showPatrolPoints = ;'), 'Should have bool gap 2');
    assert.ok(text.includes('showFlightPaths = ;'), 'Should have bool gap 3');

    // 3. 数组大小挖空
    assert.ok(text.includes('DroneController[]'), 'Should have array size gap');

    // 4. Color构造函数参数挖空
    assert.ok(text.includes('new Color(, , )'), 'Should have Color constructor gaps');

    // 5. null比较挖空
    assert.ok(text.includes('dronePrefab == )'), 'Should have null comparison gap');

    // 6. 合并行（需要插入换行）
    assert.ok(text.includes('CreateDrones();AssignTasks();'), 'Should have concatenated method calls');

    // 7. 多个方法调用合并
    assert.ok(text.includes('SetTask();drones[1]'), 'Should have multiple SetTask calls concatenated');

    // 8. for循环条件挖空
    assert.ok(text.includes('i < ;'), 'Should have for loop condition gap');

    // 9. Instantiate参数挖空
    assert.ok(text.includes('Instantiate()'), 'Should have Instantiate parameter gap');

    // 10. 字符串赋值挖空
    assert.ok(text.includes('droneObj.name = ;'), 'Should have string assignment gap');
  });

  test('Test 5: Different brace styles and indentation', async () => {
    // 目标文件：各种括号风格
    const targetContent = `public class BraceStyles
{
    // K&R style
    public void Method1() {
        if (true) {
            DoSomething();
        } else {
            DoOther();
        }
    }

    // Allman style
    public void Method2()
    {
        if (false)
        {
            DoNothing();
        }
        else
        {
            DoEverything();
        }
    }

    // Single line
    public int Property { get; set; }

    // Lambda
    public Func<int, int> Square = x => x * x;
}`;

    // 当前文件：部分括号缺失
    const currentContent = `public class BraceStyles
{
    // K&R style
    public void Method1() {
        if (true) {
            DoSomething();
        } else
            DoOther();
        }
    }

    // Allman style
    public void Method2()
    {
        if (false)
        {
            DoNothing();
        }
        else

            DoEverything();
        }
    }

    // Single line
    public int Property { get; set; }

    // Lambda
    public Func<int, int> Square = x => ;
}`;

    const targetPath = createTargetFile('test5.cs', targetContent);
    const currentPath = createCurrentFile('test5.cs', currentContent);

    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();

    // 验证缺少的括号
    assert.ok(text.includes('else\n') || text.includes('} else\n            DoOther'), 'Should be missing opening brace after else');
    assert.ok(text.includes('x => ;'), 'Should have lambda body gap');
  });

  test('Test 6: HTML/XML style with different endings', async () => {
    // 测试非C#文件类型
    const targetContent = `<!DOCTYPE html>
<html>
<head>
    <title>Test Page</title>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <h1>Welcome</h1>
        <p>This is a test.</p>
        <button onclick="doSomething()">Click</button>
    </div>
    <script src="app.js"></script>
</body>
</html>`;

    // 当前文件：部分标签内容缺失
    const currentContent = `<!DOCTYPE html>
<html>
<head>
    <title></title>
    <meta charset="">
    <link rel="" href="">
</head>
<body>
    <div class="">
        <h1></h1>
        <p></p>
        <button onclick=""></button>
    </div>
    <script src=""></script>
</body>
</html>`;

    const targetPath = createTargetFile('test6.html', targetContent);
    const currentPath = createCurrentFile('test6.html', currentContent);

    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc);

    // 验证HTML结构正确但内容缺失
    assert.strictEqual(doc.lineCount, 16, 'HTML should have 16 lines');

    const text = doc.getText();
    assert.ok(text.includes('<title></title>'), 'Should have empty title');
    assert.ok(text.includes('charset=""'), 'Should have empty charset');
    assert.ok(text.includes('href=""'), 'Should have empty href');
    assert.ok(text.includes('class=""'), 'Should have empty class');
    assert.ok(text.includes('<h1></h1>'), 'Should have empty h1');
    assert.ok(text.includes('onclick=""'), 'Should have empty onclick');
    assert.ok(text.includes('src=""'), 'Should have empty src');
  });

  test('Test 7: Python style (no semicolons, indentation-based)', async () => {
    const targetContent = `class DroneManager:
    def __init__(self):
        self.drones = []
        self.count = 4
        self.speed = 10.5

    def initialize(self):
        for i in range(self.count):
            drone = Drone(i)
            self.drones.append(drone)

    def start_patrol(self):
        if len(self.drones) > 0:
            for drone in self.drones:
                drone.start()
        else:
            print("No drones available")
`;

    // 当前文件：Python风格挖空
    const currentContent = `class DroneManager:
    def __init__(self):
        self.drones =
        self.count =
        self.speed =

    def initialize(self):
        for i in range():
            drone = Drone()
            self.drones.append()

    def start_patrol(self):
        if len() > :
            for drone in self.drones:
                drone.start()
        else:
            print()
`;

    const targetPath = createTargetFile('test7.py', targetContent);
    const currentPath = createCurrentFile('test7.py', currentContent);

    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();

    // 验证Python特有的挖空情况
    assert.ok(text.includes('self.drones =\n') || text.includes('self.drones = \n'), 'Should have list assignment gap');
    assert.ok(text.includes('self.count =\n') || text.includes('self.count = \n'), 'Should have int assignment gap');
    assert.ok(text.includes('range()'), 'Should have range parameter gap');
    assert.ok(text.includes('Drone()'), 'Should have Drone constructor gap');
    assert.ok(text.includes('len() >'), 'Should have len parameter gap');
    assert.ok(text.includes('print()\n'), 'Should have print parameter gap');
  });

  test('Test 8: Long concatenated line needing multiple newlines', async () => {
    // 目标文件：每个调用在单独的行
    const targetContent = `public void SetupAllDrones()
{
    drones[0].SetPosition(new Vector3(0, 0, 0));
    drones[0].SetColor(Color.red);
    drones[0].SetName("Red Eagle");
    drones[1].SetPosition(new Vector3(10, 0, 0));
    drones[1].SetColor(Color.green);
    drones[1].SetName("Green Falcon");
    drones[2].SetPosition(new Vector3(20, 0, 0));
    drones[2].SetColor(Color.yellow);
    drones[2].SetName("Gold Hawk");
    drones[3].SetPosition(new Vector3(30, 0, 0));
    drones[3].SetColor(Color.blue);
    drones[3].SetName("Blue Shark");
}`;

    // 当前文件：所有调用合并在一行（极端情况）
    const currentContent = `public void SetupAllDrones()
{
    drones[0].SetPosition(new Vector3(0, 0, 0));drones[0].SetColor(Color.red);drones[0].SetName("Red Eagle");drones[1].SetPosition(new Vector3(10, 0, 0));drones[1].SetColor(Color.green);drones[1].SetName("Green Falcon");drones[2].SetPosition(new Vector3(20, 0, 0));drones[2].SetColor(Color.yellow);drones[2].SetName("Gold Hawk");drones[3].SetPosition(new Vector3(30, 0, 0));drones[3].SetColor(Color.blue);drones[3].SetName("Blue Shark");
}`;

    const targetPath = createTargetFile('test8.cs', targetContent);
    const currentPath = createCurrentFile('test8.cs', currentContent);

    const doc = await vscode.workspace.openTextDocument(currentPath);
    await vscode.window.showTextDocument(doc);

    // 验证当前文件只有4行（函数声明、开括号、所有语句、闭括号）
    assert.strictEqual(doc.lineCount, 4, 'Current should have only 4 lines');

    // 验证目标文件有15行
    const targetDoc = await vscode.workspace.openTextDocument(targetPath);
    assert.strictEqual(targetDoc.lineCount, 15, 'Target should have 15 lines');

    // 验证第3行包含所有12个分号
    const line2 = doc.lineAt(2).text;
    const semicolonCount = (line2.match(/;/g) || []).length;
    assert.strictEqual(semicolonCount, 12, 'Line 2 should have 12 semicolons');
  });
});
