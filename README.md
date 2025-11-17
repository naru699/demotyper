# DemoTyper

DemoTyper is a VS Code / Cursor extension that helps presenters simulate live coding sessions. It offers a **secret typing mode** powered entirely by Smart Replace: point to a real file, work from an empty buffer, and let the extension rebuild the file diff-by-diff as you mash the keyboard.

## Getting Started

```bash
npm install
npm run compile
```

Use `F5` inside VS Code to launch an Extension Development Host, or package a VSIX with `npx vsce package`.

For a full feature list and usage guide see `项目说明.md`. Details about immutable target-file snapshots live in `docs/target-snapshot.md`.

## Usage Notes

- Secret mode 强制保持单光标，若触发多光标会自动收敛并提示，确保脚本顺序不会错乱。
- 所有秘密输入与退格操作都会串行执行并归并到同一撤销批次，`Undo` 一次即可还原整段演示，适合高频输入场景。
- 启用秘密模式前，请在资源管理器中右键目标文件并选择 **Set as Demo Target File**，否则将无法进入智能补全。
- 当检测到下一步需要换行时，会提示按 Enter 手动换行，而不是自动插入 `\n`。
