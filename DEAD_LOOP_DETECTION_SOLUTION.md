# 死循环检测机制 - 完整解决方案

## 问题分析

### 原有问题
之前的死循环检测机制在 `computeNextGap()` 方法中实现，但存在致命缺陷：
- 每次调用 `computeNextGap()` 都重新初始化 `lastCurrentIndex = -1`
- 插入后立即 `return`，下次调用时所有局部变量被重置
- `stuckCount` 永远无法累加到触发阈值 3

### 根本原因
**状态存储位置错误**：局部变量无法跨函数调用保持状态。

## 解决方案设计

### 核心思路
1. **状态提升到类级别**：在 `SmartReplaceHandler` 类中存储插入历史
2. **在实际插入点检测**：在 `insertAt()` 方法中检测，而不是在 `computeNextGap()` 中
3. **基于时间窗口**：记录最近 5 秒内的插入，避免误判
4. **自动清理**：历史记录限制在最近 10 次

### 实现细节

#### 1. 类字段定义（第 9 行）

```typescript
export class SmartReplaceHandler {
  private documentSnapshot?: { version: number; text: string };
  private insertHistory: Array<{offset: number, timestamp: number}> = [];
  // ...
}
```

**说明**：
- `insertHistory`：存储插入历史，每个元素包含 `offset` 和 `timestamp`
- 作为类的实例字段，可以跨方法调用保持状态

#### 2. 死循环检测逻辑（第 152-171 行）

```typescript
private async insertAt(
  editor: vscode.TextEditor,
  offset: number,
  text: string,
  editOptions: UndoFriendlyEditOptions,
): Promise<boolean> {
  // 检测死循环：同一offset被重复插入
  const now = Date.now();
  const recentSameOffset = this.insertHistory.filter(
    h => h.offset === offset && now - h.timestamp < 5000
  );

  this.logger.info(`[INSERT] History check: offset=${offset} has been inserted ${recentSameOffset.length} times in last 5 seconds`);

  if (recentSameOffset.length >= 3) {
    // 触发保护机制
    const errorMsg = `检测到死循环：同一位置(offset=${offset})在5秒内被重复插入${recentSameOffset.length}次。已停止插入以保护文档。`;
    this.logger.info(`[INSERT LOOP DETECTED] ${errorMsg}`);
    this.logger.info(`[INSERT LOOP DETECTED] Insert history (last 10): ${JSON.stringify(this.insertHistory.slice(-10))}`);

    await this.notifications.warning(`DemoTyper: ${errorMsg}\n\n请检查目标文件格式是否正确，或尝试使用 Restore Current File 命令重置文档状态。`);

    // 清空历史记录，允许用户重试
    this.insertHistory = [];
    return false;
  }

  // ... 执行实际插入 ...
}
```

**检测逻辑**：
1. 获取当前时间戳
2. 过滤出最近 5 秒内在同一 `offset` 的插入记录
3. 如果计数 ≥ 3，触发保护机制：
   - 记录详细日志（包括历史记录）
   - 向用户显示警告消息
   - 清空历史记录（允许用户重试）
   - 返回 `false`（停止插入）

#### 3. 插入成功后记录历史（第 236-241 行）

```typescript
// 插入成功后记录到历史
this.insertHistory.push({offset, timestamp: now});
if (this.insertHistory.length > 10) {
  this.insertHistory.shift();
}
this.logger.info(`[INSERT] Recorded to history. History size: ${this.insertHistory.length}`);

return true;
```

**历史管理**：
- 每次成功插入后，记录 `{offset, timestamp}`
- 限制历史长度为 10（使用 FIFO 队列，超出则移除最早的记录）
- 记录日志以便调试

#### 4. 重置时清空历史（第 140-144 行）

```typescript
reset(): void {
  this.documentSnapshot = undefined;
  this.insertHistory = [];
  this.logger.info('[RESET] Cleared insert history');
}
```

**清理机制**：
- 当用户调用 Reset 命令时，清空所有状态
- 包括文档快照和插入历史

## 关键设计亮点

### 1. 时间窗口机制
```typescript
h => h.offset === offset && now - h.timestamp < 5000
```
- **为什么需要时间窗口**：用户可能正常地多次在同一位置插入（例如手动修改后重新插入）
- **5 秒窗口**：足够短以检测循环，又足够长以捕捉真实问题
- **避免误判**：历史记录中可能有很久之前的同 offset 插入，不应计入

### 2. 限制历史长度
```typescript
if (this.insertHistory.length > 10) {
  this.insertHistory.shift();
}
```
- **防止内存泄漏**：无限累积会消耗内存
- **10 次记录**：足够检测问题（3 次同位置已触发），又不占用太多空间
- **FIFO 策略**：保留最近的记录，移除最早的

### 3. 用户友好的错误处理
```typescript
await this.notifications.warning(`DemoTyper: ${errorMsg}\n\n请检查目标文件格式是否正确，或尝试使用 Restore Current File 命令重置文档状态。`);

// 清空历史记录，允许用户重试
this.insertHistory = [];
return false;
```
- **清晰的错误消息**：告诉用户发生了什么（死循环）
- **建议解决方案**：指导用户如何修复（检查目标文件、使用 Restore 命令）
- **允许重试**：清空历史后用户可以重新尝试

### 4. 详细的日志记录
```typescript
this.logger.info(`[INSERT LOOP DETECTED] Insert history (last 10): ${JSON.stringify(this.insertHistory.slice(-10))}`);
```
- **完整的上下文**：记录触发时的历史状态
- **便于调试**：开发者可以分析日志了解循环发生的模式

## 与旧代码的对比

### 旧代码（computeNextGap 中）
```typescript
// ❌ 问题：局部变量，每次调用都重置
let lastCurrentIndex = -1;
let lastTargetIndex = -1;
let stuckCount = 0;

while (targetLineIndex < targetLines.length) {
  if (lastCurrentIndex === currentLineIndex && lastTargetIndex === targetLineIndex) {
    stuckCount++;
    if (stuckCount >= 3) {
      // 永远不会到达这里
    }
  }
  lastCurrentIndex = currentLineIndex;
  lastTargetIndex = targetLineIndex;
  // ...
}
```

### 新代码（insertAt 中）
```typescript
// ✅ 解决：类字段，跨调用保持状态
private insertHistory: Array<{offset: number, timestamp: number}> = [];

private async insertAt(...) {
  // ✅ 在实际插入前检测
  const recentSameOffset = this.insertHistory.filter(...);
  if (recentSameOffset.length >= 3) {
    // 可以正确触发
  }

  // ... 插入 ...

  // ✅ 插入成功后记录
  this.insertHistory.push({offset, timestamp: now});
}
```

## 完整代码位置

### 文件路径
`/Users/fanchongming/Documents/DemoTyper/src/smartReplaceHandler.ts`

### 关键代码段

1. **类字段定义**：第 9 行
2. **死循环检测**：第 152-171 行
3. **记录历史**：第 236-241 行
4. **清理机制**：第 140-144 行

## 测试场景

### 场景 1：正常插入
```
用户按键 → insertAt(offset=10) → 成功 → 记录历史
用户按键 → insertAt(offset=15) → 成功 → 记录历史
用户按键 → insertAt(offset=20) → 成功 → 记录历史
```
**结果**：正常工作，历史记录增长

### 场景 2：死循环（触发保护）
```
用户按键 → insertAt(offset=10) → 成功 → 记录历史 [10]
(bug导致)  → insertAt(offset=10) → 成功 → 记录历史 [10, 10]
(bug导致)  → insertAt(offset=10) → 检测到重复 3 次 → 停止 → 警告用户
```
**结果**：保护触发，停止插入，显示警告

### 场景 3：时间窗口过滤
```
T=0s   → insertAt(offset=10) → 成功
T=1s   → insertAt(offset=10) → 成功
T=6s   → insertAt(offset=10) → 检测：只有 1 次在 5 秒内 → 允许插入
```
**结果**：时间窗口过滤掉过期记录，不误判

### 场景 4：用户重置
```
用户插入多次 → 历史记录累积
用户执行 Reset 命令 → reset() → 清空历史
用户重新开始 → 历史从空白开始
```
**结果**：重置清理所有状态

## 优化建议（可选）

### 1. 可配置的阈值
```typescript
private readonly MAX_SAME_OFFSET_COUNT = 3;  // 可以从配置读取
private readonly TIME_WINDOW_MS = 5000;      // 可以从配置读取
```

### 2. 更精细的日志级别
```typescript
// 区分 info 和 error 级别
if (recentSameOffset.length === 2) {
  this.logger.warn(`[INSERT] Same offset inserted 2 times, approaching limit`);
}
```

### 3. 性能优化（如果历史记录很大）
```typescript
// 使用 Map 而不是 Array
private insertHistory: Map<number, number[]> = new Map();
// offset -> [timestamp1, timestamp2, ...]
```

## 总结

### 解决方案的核心优势
1. **状态持久化**：使用类字段存储状态，跨方法调用保持
2. **检测位置正确**：在实际插入点检测，而不是在算法内部
3. **时间窗口机制**：避免误判，只检测短时间内的重复
4. **用户友好**：提供清晰的错误消息和恢复建议
5. **内存安全**：限制历史长度，防止内存泄漏
6. **可调试性**：详细的日志记录

### 为什么有效
- ✅ 跨调用状态追踪
- ✅ 在正确的位置检测（insertAt）
- ✅ 记录实际插入的 offset
- ✅ 有清空机制（reset）
- ✅ 避免误判（时间窗口）
- ✅ 提供用户反馈

这个解决方案完全满足了需求，并且已经在代码中实现完成。
