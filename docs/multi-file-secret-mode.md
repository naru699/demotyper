# 多文件秘密模式实现方案

## 背景
DemoTyper 现有的智能替换模式只能跟踪一个目标快照，限制了讲师在多文件演示中来回切换的体验。Smart Replace 本身已经支持单段与多段缺失补全，因此只需让每个文件都能保存独立快照，即可在不动核心算法的前提下获得多文件能力。

## 设计目标
- **保持现有命令体验**：继续使用 `Set/Clear/Restore/Jump` 四个命令，全部针对当前编辑器，无需额外输入。
- **最少持久化状态**：仍旧利用 `globalStorage/targetSnapshot.json`，只把结构扩展成一个字典，避免新增目录或数据库。
- **纯智能模式**：只有当前编辑器存在快照时才能启用秘密模式，切换到无快照文件会自动提示并退出，不再提供 preset 分支。

## 数据结构
将 `targetSnapshot.json` 调整为 `Record<string, TargetFileSnapshot>`，一次性读写即可：

```ts
interface TargetFileSnapshot {
  uri: string;
  savedAt: number;
  content: string;
}

type TargetsMap = Record<string, TargetFileSnapshot>;
```

- 键的 `key` 优先使用 `workspace.asRelativePath(uri, false)`，如果缺少工作区就回退到 `uri.toString()`，确保不同目录同名文件不会冲突。
- `TargetFileManager` 内缓存该字典，并在每次修改后整体写回 JSON，保证实现简单。

## 核心流程

### 设置目标 (`demotyper.setAsTargetFile`)
1. 获取传入的 URI，若缺少则使用当前编辑器。
2. 读取文件文本并创建 `TargetFileSnapshot`。
3. 计算 key，执行 `targets[key] = snapshot` 并写入 JSON。
4. 通过 `StatusBarManager`、`SidebarProvider` 刷新当前文件标签。

### 清除目标 (`demotyper.clearTargetFile`)
1. 根据当前编辑器 URI 计算 key。
2. 若 map 中存在该 key，则删除并写回；否则提示“当前文件尚未设置目标”。
3. 刷新状态栏和侧边栏，让 UI 立即反映变化。

### 恢复文件 (`demotyper.restoreCurrentFile`)
1. 从当前编辑器 URI 推导 key。
2. 读取字典中的 snapshot；若不存在则提示用户先设置目标。
3. 利用现有 `editor.edit` 覆盖全文，沿用撤销批次策略。

### 跳转差异 (`demotyper.jumpToNextGap`)
1. 同样根据当前编辑器 URI 查找 snapshot。
2. 将 `snapshot.content` 传给 `SmartReplaceHandler.jumpToNextGap`。
3. 若缺少快照则弹出 warning，引导用户重新设置。

### 切换秘密模式 (`SecretModeHandler`)
1. 打开秘密模式前检查当前编辑器 key 是否存在，缺少快照则直接 warning 并拒绝进入。
2. 监听 `onDidChangeActiveTextEditor`。秘密模式开启期间，如切换到无快照文件，则自动提示并退出。
3. 其余逻辑（单光标约束、撤销批处理、串行队列）保持不变。

## UI 文案
- **状态栏**：`$(keyboard) DemoTyper: Secret (Smart · <label>)`；不在秘密模式时显示 `Ready`。
- **侧边栏**：`目标文件` 节点展示当前编辑器映射到的 label，没有快照时提示“尚未设置”。

## 出错处理
- JSON 解析失败或缺少 key：记录日志并提示用户重新设置目标，随后清理损坏项。
- 快照文件被删除：读取失败时自动从字典移除对应 key，并提示重新设置。
- 文件重命名或移动：由于 key 依赖相对路径/URI，旧快照会失效；提示用户在新路径上执行 `Set as Demo Target File` 即可。

## 实施步骤
1. **重构 `TargetFileManager`**：实现读写 map 的方法，新增 `getSnapshotForUri`、`deleteSnapshotForUri`，并让 `setTargetFile`、`clearTargetFile`、`readTargetContent` 等 API 接受可选 URI。
2. **更新命令绑定**：在 `src/extension.ts` 内，所有命令优先使用当前编辑器 URI，并在执行后刷新状态栏与侧边栏。
3. **调整 `SecretModeHandler`**：启用/切换时调用 `targetFileManager.hasTargetFile(editorUri)`，无快照即提示并退出。
4. **继续复用 `SmartReplaceHandler`**：只需要通过新的读取接口获取内容，算法无需修改。
5. **手动验证**：
   - 文件 A、B 各自设置快照，在秘密模式下切换编辑器，确认无快照的文件会触发自动退出。
   - 同一文件多段差异补全仍可顺序执行，并且单次 Undo 能完整回滚。
