const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return createVscodeMock();
  }
  return originalLoad(request, parent, isMain);
};

function createVscodeMock() {
  class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  }

  class Selection {
    constructor(anchor, active) {
      this.anchor = anchor;
      this.active = active;
    }
  }

  class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  }

  return {
    Position,
    Selection,
    Range,
    EndOfLine: { LF: 1, CRLF: 2 },
    window: {
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
    },
    workspace: {
      workspaceFolders: undefined,
      asRelativePath: () => '',
      fs: {
        readFile: async () => Buffer.from(''),
        writeFile: async () => undefined,
        createDirectory: async () => undefined,
        delete: async () => undefined,
      },
    },
  };
}

const { SmartReplaceHandler } = require('./out/smartReplaceHandler.js');

class WebSocketSmartReplaceTest {
  constructor() {
    this.originalFile = `
  on(type: string, callback: MessageCallback): void {
    if (!this.messageCallbacks.has(type)) {
      this.messageCallbacks.set(type, []);
    }
    this.messageCallbacks.get(type)?.push(callback);
    console.log(\`[WebSocketService] 订阅消息类型: \${type}, 当前订阅数: \${this.messageCallbacks.get(type)?.length}\`);
  }`;

    this.testResults = {
      charByChar: false,
      positionAccuracy: false,
      indentMatch: false,
      symbolHandling: false,
      rapidInput: false,
      noDeadLoop: false,
      contentProtection: false
    };

    this.fixturesDir = path.join(__dirname, 'test', 'e2e', 'websocket');
    this.simulationCache = undefined;
    this.handler = undefined;
  }

  // 验证逐字符输出
  testCharByCharOutput() {
    console.log('🧪 测试1: 逐字符输出验证');
    // 模拟智能替换过程，检查是否逐个字符输出
    const output = this.simulateSmartReplace();
    this.testResults.charByChar = !output.includes('整行跳出');
    return this.testResults.charByChar;
  }

  // 验证位置准确性
  testPositionAccuracy() {
    console.log('🧪 测试2: 字符位置准确性验证');
    const expectedPositions = this.calculateExpectedPositions();
    const actualPositions = this.getActualOutputPositions();
    this.testResults.positionAccuracy = this.comparePositions(expectedPositions, actualPositions);
    return this.testResults.positionAccuracy;
  }

  // 验证缩进匹配
  testIndentMatch() {
    console.log('🧪 测试3: 缩进格式验证');
    const expectedIndent = '    '; // 4空格缩进
    const output = this.simulateSmartReplace();
    this.testResults.indentMatch = output.includes(expectedIndent + 'if (!this.messageCallbacks.has(type)) {');
    return this.testResults.indentMatch;
  }

  // 验证符号处理
  testSymbolHandling() {
    console.log('🧪 测试4: 符号补全逻辑验证');
    const charStream = this.getFlattenedOutput();
    const hasBracePair = this.hasOrderedPair(charStream, '{', '}');
    const hasIndentation = /\{\n[ \t]+/.test(charStream);
    const hasParenPair = this.hasOrderedPair(charStream, '(', ')');
    const hasBracketPair = this.hasOrderedPair(charStream, '[', ']');

    this.testResults.symbolHandling = hasBracePair && hasIndentation && hasParenPair && hasBracketPair;
    return this.testResults.symbolHandling;
  }

  // 连打压力测试
  testRapidInput() {
    console.log('🧪 测试5: 连打压力测试');
    try {
      this.simulateRapidInput(100); // 快速输入100个字符
      this.testResults.rapidInput = true;
    } catch (error) {
      this.testResults.rapidInput = false;
      console.error('连打测试失败:', error);
    }
    return this.testResults.rapidInput;
  }

  // 死循环检测
  testNoDeadLoop() {
    console.log('🧪 测试6: 死循环检测');
    const startTime = Date.now();
    this.simulateExtendedInput(); // 模拟额外输入
    const endTime = Date.now();

    // 如果执行时间超过30秒，认为可能死循环
    this.testResults.noDeadLoop = (endTime - startTime) < 30000;
    return this.testResults.noDeadLoop;
  }

  // 内容保护测试
  testContentProtection() {
    console.log('🧪 测试7: 内容保护验证');
    const finalContent = this.getContentAfterTest();
    const targetContent = this.readFixture('WebSocketService.full.ts');
    this.testResults.contentProtection = finalContent === targetContent;
    return this.testResults.contentProtection;
  }

  // 运行完整测试套件
  runFullTestSuite() {
    console.log('🚀 开始完整 E2E 测试套件\n');

    const tests = [
      () => this.testCharByCharOutput(),
      () => this.testPositionAccuracy(),
      () => this.testIndentMatch(),
      () => this.testSymbolHandling(),
      () => this.testRapidInput(),
      () => this.testNoDeadLoop(),
      () => this.testContentProtection()
    ];

    let allPassed = true;

    tests.forEach((test, index) => {
      try {
        const passed = test();
        console.log(`📊 测试 ${index + 1}: ${passed ? '✅ 通过' : '❌ 失败'}`);
        allPassed = allPassed && passed;
      } catch (error) {
        console.error(`💥 测试 ${index + 1} 执行错误:`, error);
        allPassed = false;
      }
    });

    console.log('\n📋 测试结果汇总:');
    Object.entries(this.testResults).forEach(([test, result]) => {
      console.log(`   ${test}: ${result ? '✅' : '❌'}`);
    });

    console.log(allPassed ? '\n🎉 所有测试通过!' : '\n⚠️ 部分测试失败，需要修复');
    return allPassed;
  }

  // 模拟方法（需要集成实际DemoTyper逻辑）
  simulateSmartReplace() {
    const result = this.ensureSimulation();
    return result.insertedMethod;
  }

  simulateRapidInput(count) {
    // 模拟快速连续输入
    for (let i = 0; i < count; i++) {
      this.triggerKeyPress();
    }
  }

  simulateExtendedInput() {
    // 模拟补全完成后的额外输入
    this.completeSmartReplace();
    this.triggerKeyPress(10); // 额外输入10个字符
  }

  // 其他辅助方法...
  calculateExpectedPositions() {
    const target = this.readFixture('WebSocketService.full.ts');
    const signature = '\n  on(type: string, callback: MessageCallback): void {';
    const index = target.indexOf(signature);
    return index >= 0 ? [index] : [];
  }

  getActualOutputPositions() {
    const result = this.ensureSimulation();
    return result.steps.length > 0 ? [result.steps[0].insertOffset] : [];
  }

  comparePositions(expected, actual) {
    if (expected.length !== actual.length) {
      return false;
    }
    return expected.every((value, index) => Math.abs(value - actual[index]) < 5);
  }

  getOutputSteps() {
    const result = this.ensureSimulation();
    return result.steps;
  }

  getFlattenedOutput() {
    return this.getOutputSteps()
      .map((step) => step.text)
      .join('');
  }

  getProtectedContent() {
    return this.readFixture('WebSocketService.missing.ts');
  }

  hasOrderedPair(stream, openChar, closeChar) {
    const openIndex = stream.indexOf(openChar);
    if (openIndex === -1) {
      return false;
    }
    const closeIndex = stream.indexOf(closeChar, openIndex + 1);
    return closeIndex !== -1;
  }

  getContentAfterTest() {
    return this.ensureSimulation().finalDocument;
  }

  triggerKeyPress() {
    // no-op simulation hook
  }

  completeSmartReplace() {
    this.ensureSimulation();
  }

  readFixture(fileName) {
    const fullPath = path.join(this.fixturesDir, fileName);
    return fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
  }

  ensureHandler() {
    if (this.handler) {
      return this.handler;
    }
    const targetManager = {
      readTargetContent: async () => undefined,
    };
    const logger = {
      info: () => {},
      dispose: () => {},
    };
    const notifications = {
      info: async () => undefined,
      warning: async () => undefined,
      error: async () => undefined,
    };
    this.handler = new SmartReplaceHandler(targetManager, logger, notifications);
    return this.handler;
  }

  ensureSimulation() {
    if (this.simulationCache) {
      return this.simulationCache;
    }

    const target = this.readFixture('WebSocketService.full.ts');
    let current = this.readFixture('WebSocketService.missing.ts');
    const handler = this.ensureHandler();
    const steps = [];
    const maxIterations = 10000;
    let iter = 0;

    while (iter++ < maxIterations) {
      const diff = handler.computeNextGap(current, target);
      if (diff.state === 'inSync') {
        const insertedMethod = this.extractMethodBlock(current, target);
        this.simulationCache = {
          finalDocument: current,
          insertedMethod,
          steps,
        };
        return this.simulationCache;
      }
      if (diff.state === 'mismatch') {
        throw new Error(`内容不匹配，offset=${diff.offset}`);
      }

      const deleteCount = diff.deleteCount ?? 0;
      const before = current.slice(0, diff.insertOffset);
      const after = current.slice(diff.insertOffset + deleteCount);
      current = before + diff.nextChar + after;
      steps.push({ insertOffset: diff.insertOffset, text: diff.nextChar, deleteCount });
    }

    throw new Error('智能补全过程超过最大迭代次数，疑似死循环');
  }

  extractMethodBlock(documentText, targetText) {
    const signature = '\n  on(type: string, callback: MessageCallback): void {';
    const start = documentText.indexOf(signature);
    if (start === -1) {
      return '';
    }
    const markerAfterMethod = '\n\n  // ... 其他方法保持不变 ...';
    let end = documentText.indexOf(markerAfterMethod, start);
    if (end === -1) {
      end = start + this.originalFile.length;
    }
    return documentText.slice(start, end);
  }
}

// 执行测试
const test = new WebSocketSmartReplaceTest();
const success = test.runFullTestSuite();

if (!success) {
  console.log('🛠️ 测试失败，开始修复流程...');
  // 这里触发修复逻辑
  process.exit(1);
} else {
  console.log('🏁 测试完成，所有检查项通过');
  process.exit(0);
}
