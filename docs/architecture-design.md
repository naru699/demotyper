# DemoTyper 智能换行插入架构设计

## 📋 目标

实现7个语言感知和性能优化特性，使换行插入逻辑更智能、更高效。

---

## 🏗️ 总体架构

```
┌─────────────────────────────────────────────────────────┐
│               SmartReplaceHandler                        │
│  (主控制器，协调所有模块)                                 │
└─────────────────────┬───────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
┌──────────────────┐    ┌──────────────────────┐
│  LanguageDetector│    │  PerformanceCache     │
│  (语言识别)       │    │  (性能缓存)           │
└────────┬─────────┘    └──────────────────────┘
         │
    ┌────┴─────┬──────────┬──────────┬──────────┐
    ▼          ▼          ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Python  │ │C-Like  │ │HTML/XML│ │Indent  │ │String  │
│Analyzer│ │Analyzer│ │Analyzer│ │Analyzer│ │Handler │
└────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

---

## 📦 模块设计

### 1. LanguageDetector (语言检测器)

**职责**: 识别文档语言，选择合适的分析器

**输入**:
- 文件扩展名
- VS Code languageId
- 文件内容特征

**输出**:
- 语言类型枚举
- 适用的分析器列表

```typescript
enum LanguageType {
  Python,
  CFamily,        // C, C++, C#, Java
  JavaScript,     // JavaScript, TypeScript
  HTML,
  XML,
  IndentBased,    // YAML, etc.
  Unknown
}

interface LanguageInfo {
  type: LanguageType;
  analyzers: LanguageAnalyzer[];
  config: LanguageConfig;
}
```

---

### 2. Python Analyzer (Python 分析器)

**特性**:
- 识别冒号结尾的语句（if:, def:, class:, for:, while:, etc.）
- 检测代码块边界
- 处理装饰器 (@decorator)

**核心逻辑**:

```typescript
interface PythonBlockDetector {
  // 检测是否是块开始（以冒号结尾）
  isBlockStart(line: string): boolean;

  // 检测块类型
  getBlockType(line: string): 'if' | 'def' | 'class' | 'for' | 'while' | 'try' | 'with' | null;

  // 计算预期的下一行缩进
  getExpectedIndent(currentLine: string, currentIndent: string): string;

  // 检测是否在多行字符串中 (""" or ''')
  isInMultilineString(lines: string[], lineIndex: number): boolean;
}
```

**使用场景**:

```python
# Target:
def calculate():
    if x > 0:
        return x * 2
    return 0

# Current (删除了第3行):
def calculate():
    if x > 0:
    return 0

# 检测逻辑:
# 1. Line 2: "if x > 0:" → isBlockStart() = true
# 2. 预期下一行缩进: 当前4空格 + 4 = 8空格
# 3. Current Line 3: "return 0" → 缩进4空格（不是8）
# 4. 判断: 缺失了一行 → 插入换行
```

---

### 3. C-Like Analyzer (C系语言分析器)

**支持语言**: C, C++, C#, Java, JavaScript, TypeScript

**特性**:
- 识别大括号配对 `{ }`
- 跟踪嵌套层级
- 检测语句结束符 `;`
- 处理特殊情况（条件三元运算符、数组初始化）

**核心逻辑**:

```typescript
interface BraceTracker {
  // 跟踪大括号平衡
  depth: number;

  // 更新状态
  updateWithLine(line: string): void;

  // 检测是否需要换行
  shouldInsertNewline(currentLine: string, targetLine: string): boolean;

  // 检测块边界
  isBlockBoundary(line: string): 'open' | 'close' | 'both' | null;
}

interface StatementDetector {
  // 检测语句是否完整（考虑分号、大括号）
  isCompleteStatement(line: string): boolean;

  // 检测多个语句在同一行（如 "int a=1;int b=2;"）
  hasMultipleStatements(line: string): boolean;

  // 分割多个语句
  splitStatements(line: string): string[];
}
```

**使用场景**:

```cpp
// Target:
if (condition) {
    doSomething();
    doMore();
}

// Current (删除了第3行):
if (condition) {
    doSomething();
}

// 检测逻辑:
// 1. Line 1: "if (condition) {" → openBrace, depth=1
// 2. Line 2: "doSomething();" → depth=1, 语句完整
// 3. Line 3: "}" → closeBrace, depth=0
// 4. 检查: depth从1→0，但Target中depth在第3行还是1
// 5. 判断: 缺失了语句 → 向前查找确认
```

---

### 4. HTML/XML Analyzer (标签分析器)

**特性**:
- 识别开始标签 `<div>`
- 识别结束标签 `</div>`
- 识别自闭合标签 `<img />`
- 跟踪标签嵌套
- 处理属性中的换行

**核心逻辑**:

```typescript
interface TagParser {
  // 解析标签
  parseTag(line: string): Tag | null;

  // 检测标签类型
  getTagType(tag: string): 'open' | 'close' | 'self-closing' | 'comment';

  // 提取标签名
  getTagName(tag: string): string;

  // 跟踪嵌套深度
  depth: number;
}

interface Tag {
  type: 'open' | 'close' | 'self-closing';
  name: string;
  hasAttributes: boolean;
  isMultiline: boolean;
}
```

**使用场景**:

```html
<!-- Target: -->
<div class="container">
    <h1>Title</h1>
    <p>Content</p>
</div>

<!-- Current (删除了第3行): -->
<div class="container">
    <h1>Title</h1>
</div>

<!-- 检测逻辑: -->
<!-- 1. Line 1: <div> → open, depth=1 -->
<!-- 2. Line 2: <h1> → open, depth=2; </h1> → close, depth=1 -->
<!-- 3. Line 3: </div> → close, depth=0 -->
<!-- 4. 检查: Target第3行应该还在depth=1（还有<p>标签） -->
<!-- 5. 判断: 缺失了一行 → 插入换行 -->
```

---

### 5. Indentation Analyzer (缩进分析器)

**适用**: YAML, Python, CoffeeScript, Pug/Jade

**特性**:
- 纯粹基于缩进的块检测
- 不依赖语法符号（冒号、大括号）
- 检测缩进层级变化

**核心逻辑**:

```typescript
interface IndentationTracker {
  // 计算缩进层级
  getIndentLevel(line: string): number;

  // 检测缩进变化方向
  getIndentChange(prevLine: string, currentLine: string): 'increase' | 'decrease' | 'same';

  // 检测是否应该有更多缩进的子行
  expectsMoreIndentedLines(currentIndent: number, targetIndent: number): boolean;
}
```

**使用场景**:

```yaml
# Target:
config:
  database:
    host: localhost
    port: 5432
  cache:
    enabled: true

# Current (删除了第4行):
config:
  database:
    host: localhost
  cache:
    enabled: true

# 检测逻辑:
# 1. Line 2: "  database:" → indent=2
# 2. Line 3: "    host: localhost" → indent=4 (增加)
# 3. Line 4: "  cache:" → indent=2 (减少到与database同级)
# 4. 检查: indent从4直接降到2，跳过了应该存在的indent=4的行
# 5. 判断: 缺失了配置项 → 插入换行
```

---

### 6. Multi-line String Handler (多行字符串处理器)

**支持格式**:
- Python: `"""..."""`, `'''...'''`
- JavaScript/TypeScript: `` `...` ``
- C++: `R"(...)"`
- 其他

**特性**:
- 检测是否在多行字符串中
- 在字符串内部禁用换行插入
- 检测字符串边界

**核心逻辑**:

```typescript
interface MultilineStringDetector {
  // 检测是否在多行字符串中
  isInsideMultilineString(lines: string[], lineIndex: number, language: LanguageType): boolean;

  // 查找字符串起始位置
  findStringStart(lines: string[], fromLine: number): number | null;

  // 查找字符串结束位置
  findStringEnd(lines: string[], fromLine: number): number | null;

  // 获取字符串定界符
  getStringDelimiter(language: LanguageType): string[];
}
```

**使用场景**:

```python
# Target:
description = """
This is a multi-line
string that spans
several lines.
"""

# Current (用户在第3行打字):
description = """
This is a multi-line
[光标在这里]
"""

# 检测逻辑:
# 1. 扫描前面的行，找到 """ (line 1)
# 2. 扫描后面的行，找到 """ (line 4)
# 3. 判断: 当前行在多行字符串内部
# 4. 决策: 禁用智能换行插入，只做普通字符填充
```

---

### 7. Performance Cache (性能缓存)

**目标**: 减少重复计算，提升性能

**缓存内容**:
- LCS计算结果
- 语言检测结果
- 缩进层级
- 大括号深度
- 标签嵌套深度

**核心逻辑**:

```typescript
interface CacheManager {
  // LCS缓存
  lcsCache: Map<string, number>;  // key: "line1|line2", value: lcs length

  // 行分析缓存
  lineAnalysisCache: Map<number, LineAnalysis>;

  // 获取或计算
  getOrCompute<T>(key: string, computeFn: () => T): T;

  // 清除缓存
  invalidate(): void;

  // 部分清除（仅清除指定范围）
  invalidateRange(startLine: number, endLine: number): void;
}

interface LineAnalysis {
  indentLevel: number;
  braceDepth: number;
  tagDepth: number;
  isBlockStart: boolean;
  isCompleteStatement: boolean;
  inMultilineString: boolean;
}
```

**缓存策略**:

```typescript
// 1. LCS缓存（最重要）
function getCachedLCS(line1: string, line2: string): number {
  const key = `${line1}|${line2}`;

  if (this.lcsCache.has(key)) {
    return this.lcsCache.get(key)!;
  }

  const result = this.lcsLength(line1, line2);

  // 限制缓存大小（LRU策略）
  if (this.lcsCache.size > 1000) {
    const firstKey = this.lcsCache.keys().next().value;
    this.lcsCache.delete(firstKey);
  }

  this.lcsCache.set(key, result);
  return result;
}

// 2. 增量计算
// 只分析可见范围 ±50行
function analyzeVisibleRange(currentLine: number): void {
  const start = Math.max(0, currentLine - 50);
  const end = Math.min(totalLines, currentLine + 50);

  for (let i = start; i < end; i++) {
    if (!this.lineAnalysisCache.has(i)) {
      this.lineAnalysisCache.set(i, this.analyzeLine(i));
    }
  }
}

// 3. 文档修改时部分清除
function onDocumentChange(startLine: number, endLine: number): void {
  // 只清除受影响的行
  this.invalidateRange(startLine, endLine);

  // LCS缓存保留（因为是基于内容的，不是基于行号的）
}
```

---

## 🔧 配置选项

```typescript
interface DemoTyperConfig {
  // 基础配置
  enableLogging: boolean;

  // 语言感知功能开关
  languageAwareness: {
    enabled: boolean;
    python: {
      enabled: boolean;
      detectColonBlocks: boolean;
      handleDecorators: boolean;
    };
    cLike: {
      enabled: boolean;
      trackBraces: boolean;
      splitMultipleStatements: boolean;
    };
    html: {
      enabled: boolean;
      trackTags: boolean;
      handleAttributes: boolean;
    };
    indentation: {
      enabled: boolean;
      strictMode: boolean;  // 严格模式：缩进必须严格匹配
    };
  };

  // 多行字符串
  multilineStrings: {
    enabled: boolean;
    disableSmartNewline: boolean;  // 在字符串内禁用智能换行
  };

  // 性能优化
  performance: {
    enableCaching: boolean;
    cacheSize: number;  // LCS缓存大小限制
    visibleRangeLines: number;  // 可见范围行数（±N行）
  };

  // 相似度和查找
  similarity: {
    threshold: number;  // 默认0.5
    algorithm: 'lcs' | 'positional';  // 允许回退到旧算法
  };

  lookAhead: {
    maxDistance: number;  // 默认10
    useFlexibleMatching: boolean;  // 忽略尾部空白和注释
  };
}
```

---

## 🔄 执行流程

### 主流程 (handleTyping)

```typescript
function handleTyping(key: string): InsertResult {
  // 1. 语言检测（仅第一次或文档类型变化时）
  if (!this.languageInfo || this.documentChanged) {
    this.languageInfo = this.languageDetector.detect(document);
  }

  // 2. 多行字符串检测
  if (this.config.multilineStrings.enabled) {
    if (this.stringHandler.isInsideMultilineString(currentLine)) {
      // 在字符串内：禁用智能换行，只做普通填充
      return this.normalCharacterFill(key);
    }
  }

  // 3. 标准行比对
  const matchResult = this.compareLines(currentLine, targetLine);

  if (matchResult.matched) {
    // 行匹配，检查是否需要换行
    return this.checkNewlineAfterMatch(matchResult);
  }

  // 4. 行不匹配，进行相似度检测
  const similarity = this.cache.getOrCompute(
    `lcs_${currentLine}_${targetLine}`,
    () => this.calculateLineSimilarity(currentLine, targetLine)
  );

  if (similarity < this.config.similarity.threshold) {
    // 5. 低相似度，使用语言分析器增强判断
    const shouldInsert = this.analyzeWithLanguage(
      currentLine,
      targetLine,
      this.languageInfo
    );

    if (shouldInsert) {
      return { state: 'gap', insertNewline: true };
    }
  }

  // 6. 向前查找（使用缓存的分析结果）
  const lookAheadResult = this.performLookAhead(currentLine, targetLine);

  if (lookAheadResult.found) {
    return { state: 'gap', insertNewline: true };
  }

  // 7. 默认：逐字符填充
  return this.normalCharacterFill(key);
}
```

### 语言感知分析

```typescript
function analyzeWithLanguage(
  currentLine: string,
  targetLine: string,
  languageInfo: LanguageInfo
): boolean {

  switch (languageInfo.type) {
    case LanguageType.Python:
      return this.pythonAnalyzer.shouldInsertNewline(currentLine, targetLine);

    case LanguageType.CFamily:
    case LanguageType.JavaScript:
      return this.cLikeAnalyzer.shouldInsertNewline(currentLine, targetLine);

    case LanguageType.HTML:
    case LanguageType.XML:
      return this.htmlAnalyzer.shouldInsertNewline(currentLine, targetLine);

    case LanguageType.IndentBased:
      return this.indentAnalyzer.shouldInsertNewline(currentLine, targetLine);

    default:
      // 未知语言：回退到纯LCS判断
      return false;
  }
}
```

---

## 📊 性能评估

### 各模块复杂度

| 模块 | 时间复杂度 | 空间复杂度 | 触发频率 |
|------|-----------|-----------|---------|
| 语言检测 | O(1) | O(1) | 一次/文档 |
| Python分析 | O(n) | O(1) | 每次按键 |
| C-like分析 | O(n) | O(1) | 每次按键 |
| HTML分析 | O(n) | O(1) | 每次按键 |
| 缩进分析 | O(1) | O(1) | 每次按键 |
| 字符串检测 | O(n) | O(1) | 每次按键 |
| LCS计算 | O(m×n) | O(n) | 有缓存时少 |
| 向前查找 | O(10) | O(1) | 行不匹配时 |

### 优化后的总体性能

**无缓存**:
- 短行（<100字符）: ~5-10ms
- 中行（100-200字符）: ~20-50ms
- 长行（>200字符）: ~50-100ms

**有缓存**（第二次及以后）:
- 所有情况: <1ms（缓存命中）

---

## 🧪 测试策略

### 1. 单元测试（每个分析器）

```typescript
// Python Analyzer Tests
test('Python: detect colon block start', () => {
  expect(pythonAnalyzer.isBlockStart('if x > 0:')).toBe(true);
  expect(pythonAnalyzer.isBlockStart('def foo():')).toBe(true);
  expect(pythonAnalyzer.isBlockStart('x = 1')).toBe(false);
});

// C-like Analyzer Tests
test('C-like: track brace depth', () => {
  const tracker = new BraceTracker();
  tracker.updateWithLine('if (x) {');
  expect(tracker.depth).toBe(1);
  tracker.updateWithLine('    doSomething();');
  expect(tracker.depth).toBe(1);
  tracker.updateWithLine('}');
  expect(tracker.depth).toBe(0);
});

// HTML Analyzer Tests
test('HTML: parse tags correctly', () => {
  expect(htmlAnalyzer.parseTag('<div class="test">')).toEqual({
    type: 'open',
    name: 'div',
    hasAttributes: true
  });
});
```

### 2. 集成测试（完整场景）

```typescript
test('Integration: Python function with missing line', async () => {
  const target = `def calculate():
    if x > 0:
        return x * 2
    return 0`;

  const current = `def calculate():
    if x > 0:
    return 0`;

  const result = await testTyping(target, current);

  expect(result.newlinesInserted).toBe(1);
  expect(result.finalContent).toBe(target);
});
```

### 3. 性能测试

```typescript
test('Performance: LCS with caching', () => {
  const line1 = 'const result = await fetchData(url, options);';
  const line2 = 'const result = fetchData(url, options);';

  // 第一次：计算
  const start1 = performance.now();
  const result1 = handler.calculateLineSimilarity(line1, line2);
  const time1 = performance.now() - start1;

  // 第二次：缓存
  const start2 = performance.now();
  const result2 = handler.calculateLineSimilarity(line1, line2);
  const time2 = performance.now() - start2;

  expect(result1).toBe(result2);
  expect(time2).toBeLessThan(time1 * 0.1);  // 缓存至少快10倍
});
```

---

## 📈 实施路线图

### Phase 1: 基础框架（1-2天）
- ✅ 创建模块接口定义
- ✅ 实现 LanguageDetector
- ✅ 实现 CacheManager
- ✅ 添加配置选项

### Phase 2: 语言分析器（3-5天）
- ✅ 实现 PythonAnalyzer
- ✅ 实现 CLikeAnalyzer
- ✅ 实现 HTMLAnalyzer
- ✅ 实现 IndentationAnalyzer

### Phase 3: 增强功能（2-3天）
- ✅ 实现 MultilineStringHandler
- ✅ 优化缓存策略
- ✅ 集成到主流程

### Phase 4: 测试和优化（2-3天）
- ✅ 编写单元测试
- ✅ 编写集成测试
- ✅ 性能基准测试
- ✅ 实际场景验证

### Phase 5: 文档和发布（1天）
- ✅ 更新用户文档
- ✅ 编写迁移指南
- ✅ 打包发布

**总计**: 9-14天

---

## 🎯 成功指标

1. **准确率**:
   - 正确插入换行: >95%
   - 误判率: <5%

2. **性能**:
   - 无缓存响应时间: <50ms (90th percentile)
   - 有缓存响应时间: <1ms (99th percentile)
   - 内存占用: <10MB

3. **兼容性**:
   - 支持语言: Python, C/C++/C#, Java, JavaScript/TypeScript, HTML/XML, YAML
   - 向后兼容: 旧功能不受影响

4. **用户体验**:
   - 配置简单: 默认配置满足80%场景
   - 可调整: 高级用户可精细调优
   - 无感知: 智能功能在后台工作，用户无需关注

---

这个设计文档提供了完整的架构蓝图。接下来我将开始实现！
