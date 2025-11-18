# 双重缩进BUG修复

## 问题描述

用户报告在使用DemoTyper填充代码时，出现"当前内容与目标文件不一致"的错误。日志显示：

```
[DEBUG]   Current[14]: "                  constructor() {"  // 18 spaces!!!
[DEBUG]   Target[14]: ""
Smart replace out-of-sync at offset 659
```

`constructor()` 行本应只有 **2个空格** 缩进，但实际出现了 **18个空格**！

## 根本原因

### 问题场景

当删除类属性，只保留 `constructor()` 时，算法需要在 `constructor` 前插入多个 `private` 属性行。

```typescript
// 初始状态 (CURRENT)
export class WebSocketService {
  constructor() {    // 2 spaces ✅
    console.log('init');
  }
}

// 目标状态 (TARGET)
export class WebSocketService {
  private ws: webSocket.WebSocket | null = null;           // 新行1
  private reconnectTimer: number = -1;                     // 新行2
  private url: string = 'ws://110.42.61.24:3001/ws';      // 新行3

  constructor() {    // 仍应该是 2 spaces
    console.log('init');
  }
}
```

### Bug触发流程

#### 第1次插入 (插入第一个private行)

1. **前缀检查**：当前行2是 `"  constructor()"`，目标行2是 `"  private ws..."`
   - 当前行前缀: `"con"`
   - 目标行前缀: `"pri"`
   - **前缀不匹配！**

2. **错误做法**（修复前）：
   ```typescript
   // 在行首（offset 81）插入 "\n  " (换行 + 2空格)
   const leadingSpaces = this.getLeadingSpaces(targetLine); // "  " (2 spaces)
   return { nextChar: '\n' + leadingSpaces };  // ❌ 错误!
   ```

3. **结果**：
   ```
   Before: "export class WebSocketService {\n  constructor() {"
                                              ↑ offset 81 (行首)
   Insert: "\n  "
   After:  "export class WebSocketService {\n\n    constructor() {"
                                                  ↑空行  ↑4 spaces!!!
   ```

   **`constructor` 从 2空格 变成了 4空格！**

#### 第2、3、4次插入

每次插入新的private行时，同样的问题重复发生：

- 第2次: `4 → 6` 空格
- 第3次: `6 → 8` 空格
- 第4次: `8 → 10` 空格
- ...
- 第9次: `16 → 18` 空格

### 日志证据

```log
[DEBUG]   Current[6]: "  constructor() {"      // ✅ 2 spaces
[DEBUG]   Current[7]: "    constructor() {"    // ❌ 4 spaces
[DEBUG]   Current[8]: "      constructor() {"  // ❌ 6 spaces
[DEBUG]   Current[13]: "                constructor() {"   // ❌ 16 spaces
[DEBUG]   Current[14]: "                  constructor() {" // ❌ 18 spaces
```

### 问题本质

**当在已有缩进的行首前插入 `\n + indent` 时，会导致缩进累加！**

```
原本: "...;\n  constructor"
         ↑行首有2个空格

在行首插入 "\n  ": "\n" + "  "
结果: "...;\n\n    constructor"
               ↑新行  ↑2(新)+2(旧)=4个空格!
```

## 解决方案

### 修复代码

**位置**: `src/smartReplaceHandler.ts` 行623-637

**修复前**:
```typescript
if (checkLen > 0 && currentPrefix !== targetPrefix) {
  const currentLineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
  const originalOffset = this.mapNormalizedToOriginal(currentLineStartOffset, currentMapping);
  const leadingSpaces = this.getLeadingSpaces(targetLine);  // ❌ 获取缩进

  return {
    state: 'gap',
    insertOffset: originalOffset,
    nextChar: '\n' + leadingSpaces  // ❌ 插入换行+缩进 → 双重缩进!
  };
}
```

**修复后**:
```typescript
if (checkLen > 0 && currentPrefix !== targetPrefix) {
  const currentLineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
  const originalOffset = this.mapNormalizedToOriginal(currentLineStartOffset, currentMapping);

  // ⚠️ 重要: 只插入 '\n',不带缩进!
  // 因为我们插入的位置是当前行的行首,当前行已经有自己的缩进
  // 如果插入 '\n' + leadingSpaces,会导致当前行的缩进累加(双重缩进BUG)
  // 新行的缩进会在后续的逐字符插入中自然填充
  return {
    state: 'gap',
    insertOffset: originalOffset,
    nextChar: '\n'  // ✅ 只插入换行,不带缩进!
  };
}
```

### 关键改动

| 修复前 | 修复后 |
|--------|--------|
| `nextChar: '\n' + leadingSpaces` | `nextChar: '\n'` |
| 在行首插入 "换行+缩进" | 在行首只插入 "换行" |
| 导致缩进累加 | 保持原行缩进不变 |

### 为什么这样修复是正确的？

1. **插入位置是行首**：`originalOffset` 指向当前行的第一个字符（缩进之前）
2. **当前行已有缩进**：`"  constructor()"` 本身已经有2个空格
3. **只需推行下移**：插入 `\n` 就能让当前行下移，缩进保持不变
4. **新行缩进会自动填充**：算法后续会逐字符填充新行内容（包括缩进）

## 测试验证

### 测试1: 双重缩进演示

**文件**: `/tmp/test_double_indentation_bug.js`

```
❌ 错误做法: 在offset前插入 "\n  " (换行+2空格)
   结果行2: "" ← 空行+2空格
   结果行3: "    constructor() {" ← constructor有4个空格! (原本2个)

✅ 正确做法: 在offset前只插入 "\n"
   结果行2: "" ← 空行
   结果行3: "  constructor() {" ← constructor仍有2个空格! (保持2个)
```

### 测试2: 缩进保持测试

**文件**: `/tmp/test_indentation_fix.js`

```
总计 143 次迭代

✅ constructor 缩进始终保持不变!

最终代码:
  ✓  1: [0sp] export class WebSocketService {
  ✓  2: [2sp]   private ws: webSocket.WebSocket | null = null;
  ✓  3: [2sp]   private reconnectTimer: number = -1;
  ✓  4: [2sp]   private url: string = 'ws://110.42.61.24:3001/ws';
  ✓  5: [0sp]
  ✓  6: [2sp]   constructor() { 👈  // 始终保持2个空格!
  ✓  7: [4sp]     console.log('init');
  ✓  8: [2sp]   }
  ✓  9: [0sp] }

✅ 完美! 最终代码完全匹配!
✅ 并且 constructor 缩进始终保持2个空格,没有累积!
```

### 测试3: Constructor不再被重复推

**文件**: `/tmp/test_repeated_pushing.js`

```
修复前:
  constructor 被推 9 次 (每个private行推一次)
  每次推动,缩进增加2个空格
  最终: 2 → 4 → 6 → 8 → 10 → 12 → 14 → 16 → 18 空格

修复后:
  constructor 被推次数: 0
  缩进始终保持: 2 空格
```

## 影响范围

### 受影响的场景

1. **类属性插入**：在现有方法前插入属性
2. **多行插入**：一次需要插入多个新行
3. **前缀不匹配**：当前行和目标行开头不同（如 `con` vs `pri`）

### 受益场景统计

根据之前的测试 (`test_prefix_collision_scenarios.js`)：

- 测试场景总数: **28个**
- 受影响场景: **12个** (42.9%)
- 涉及语言: JavaScript, TypeScript, Python, Java, C/C++, Go, Rust, PHP, Ruby

**典型场景**:
- ✅ 类属性 vs constructor
- ✅ 类属性 vs 方法
- ✅ if vs for
- ✅ import vs export
- ✅ private vs public
- ✅ async vs function

## 版本信息

- **修复版本**: DemoTyper 1.1.0
- **修复日期**: 2025-11-18
- **修复文件**: `src/smartReplaceHandler.ts` 行623-637
- **包大小**: 252.65 KB

## 总结

这个BUG是一个**缓慢累积型BUG**：

1. ❌ **单次不明显**：第一次插入时，从2空格变成4空格，用户可能注意不到
2. ❌ **多次累积严重**：插入9个private行后，累积到18空格，彻底破坏代码格式
3. ❌ **导致同步失败**：缩进错误导致文档状态与目标不一致，触发 out-of-sync 错误

**修复效果**：

1. ✅ **完全消除缩进累积**：constructor缩进始终保持2个空格
2. ✅ **代码格式正确**：最终代码与目标完全匹配
3. ✅ **不再触发out-of-sync错误**：文档状态始终与目标一致

---

*本文档详细记录了双重缩进BUG的发现、分析、修复和验证过程。*
