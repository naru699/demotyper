# Target File Snapshot Storage

## 背景与目标
- “Set as Demo Target File” 会把选中的文件定格为演示脚本，需要保证之后无论原文件如何编辑/保存，都不会影响演示内容。
- 早期做法在执行智能替换或 “Restore Current File” 时直接读取真实文件，导致只要演示者按 `Ctrl+S`，缓存内容就被覆写，脚本不再可控。
- 现行方案改为在设置目标文件时立即生成快照，并将快照存储在扩展自己的 `globalStorage` 中，与工作区隔离。

## 方案概述
1. **即时捕获**：执行 “Set as Demo Target File” 时读取文件的最新文本，写入 `{ uri, savedAt, content }` 结构。
2. **全局存储**：快照保存到 VS Code 分配的 `globalStorage` 目录下的 `targetSnapshot.json`，不会跟随工作区同步，也不会被 Git 追踪。
3. **只读回放**：智能替换与 “Restore Current File” 只读取 JSON 中的 `content` 字段，绝不再访问原文件，因此原文件可随意修改。
4. **可重复生成**：再次执行 “Set as Demo Target File” 会覆盖快照；“Clear Demo Target File” 则删除快照文件，让状态回到初始。

## 文件位置
- Windows: `%APPDATA%\Code\User\globalStorage\demotyper.demotyper/targetSnapshot.json`
- macOS: `~/Library/Application Support/Code/User/globalStorage/demotyper.demotyper/targetSnapshot.json`
- Linux: `~/.config/Code/User/globalStorage/demotyper.demotyper/targetSnapshot.json`

> VS Code 会根据不同发行渠道（Code、Cursor 等）调整根路径，但快照文件名始终是 `targetSnapshot.json`。

## 使用提醒
- 重新执行 “Set as Demo Target File” 是刷新快照的唯一方式；否则 DemoTyper 会继续使用旧内容。
- 如果删除了目标文件或清空了 VS Code 的全局存储，快照也会消失，需要重新设置一次目标文件。
