# DemoTyper

<p align="center">
  <img src="resources/demotyper.svg" alt="DemoTyper Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Simulate live coding demos with secret typing mode</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#commands">Commands</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#contributing">Contributing</a>
</p>

---

DemoTyper is a VS Code / Cursor extension that helps presenters simulate live coding sessions. It offers a **secret typing mode** powered by Smart Replace: point to a target file, work from an empty buffer, and let the extension rebuild the file character-by-character as you type randomly on the keyboard.

Perfect for:
- **Live coding presentations** - Look like you're typing real code while the extension does the work
- **Teaching & tutorials** - Focus on explaining while "typing" at your own pace
- **Screen recordings** - Create professional coding demos without mistakes

## Features

- **Secret Typing Mode** - Any key you press outputs the next correct character from your target file
- **Smart Replace Algorithm** - Intelligent diff-based character insertion with auto-pairing support
- **Bracket Auto-Pairing** - Automatically handles `{}`, `()`, `[]` with proper cursor positioning
- **Multi-line Support** - Seamlessly handles newlines, indentation, and code blocks
- **Undo Friendly** - All secret inputs merge into a single undo batch
- **Single Cursor Enforcement** - Automatically collapses multi-cursor to prevent script errors

## Installation

### From VSIX (Recommended)

1. Download the latest `.vsix` file from [Releases](https://github.com/fcmNaNo2/demotyper/releases)
2. In VS Code, press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Run `Extensions: Install from VSIX...`
4. Select the downloaded file

### From Source

```bash
git clone https://github.com/fcmNaNo2/demotyper.git
cd demotyper
npm install
npm run compile
```

Press `F5` to launch an Extension Development Host, or package with:

```bash
npx vsce package
```

## Usage

### Quick Start

1. **Prepare your target file** - Write the code you want to "type" in a file
2. **Set as target** - Right-click the file in Explorer → **Set as Demo Target File**
3. **Open your demo file** - Create or open an empty file where you'll perform
4. **Enable secret mode** - Press `Ctrl+Shift+Alt+S` (or `Cmd+Shift+Alt+S` on Mac)
5. **Start "typing"** - Press any keys and watch the correct code appear!

### Tips

- Press `Enter` when the extension prompts for a newline
- Use `Backspace` normally - it works as expected
- Press `Ctrl+Shift+Alt+S` again to exit secret mode
- Use `Ctrl+Z` to undo entire demo segments at once

## Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `DemoTyper: Toggle Secret Mode` | Enable/disable secret typing | `Ctrl+Shift+Alt+S` |
| `DemoTyper: Set as Demo Target File` | Set the selected file as target | Right-click menu |
| `DemoTyper: Clear Demo Target File` | Remove the current target file | - |
| `DemoTyper: Restore Editor from Target File` | Reset editor to match target | - |
| `DemoTyper: Jump to Next Difference` | Navigate to next diff position | - |
| `DemoTyper: Show Debug Info` | Display current sync status | - |

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `demotyper.enableLogging` | boolean | `true` | Enable verbose debug logging |
| `demotyper.notifications.muteGuidance` | boolean | `false` | Silence pop-up guidance messages |

## How It Works

DemoTyper uses a sophisticated Smart Replace algorithm that:

1. **Compares** your current editor content with the target file
2. **Finds** the next character difference using line-based diff
3. **Inserts** the correct character at the right position
4. **Handles** special cases like bracket pairing, indentation, and code blocks

The algorithm includes multiple guards to prevent infinite loops and handle edge cases like `} catch`, `} else`, and nested brackets.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting a PR.

- [Report bugs](https://github.com/fcmNaNo2/demotyper/issues/new?template=bug_report.md)
- [Request features](https://github.com/fcmNaNo2/demotyper/issues/new?template=feature_request.md)
- [Submit pull requests](https://github.com/fcmNaNo2/demotyper/pulls)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by the need for better live coding presentations
- Built with TypeScript and the VS Code Extension API

---

<p align="center">
  Made with ❤️ for the developer community
</p>
