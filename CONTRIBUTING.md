# Contributing to DemoTyper

First off, thank you for considering contributing to DemoTyper! It's people like you that make DemoTyper such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (code snippets, target file content, etc.)
- **Describe the behavior you observed and what you expected**
- **Include screenshots or GIFs** if applicable
- **Include your environment details** (VS Code version, OS, extension version)

### Suggesting Features

Feature suggestions are welcome! Please:

- **Use a clear and descriptive title**
- **Provide a detailed description** of the suggested feature
- **Explain why this feature would be useful** to most users
- **List any alternatives you've considered**

### Pull Requests

1. **Fork the repo** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes** and ensure they follow the existing code style
4. **Test your changes**: `npm run compile` should pass without errors
5. **Update documentation** if needed
6. **Submit your PR** with a clear description of the changes

## Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/demotyper.git
cd demotyper

# Install dependencies
npm install

# Compile
npm run compile

# Watch mode (for development)
npm run watch
```

### Testing Your Changes

1. Press `F5` in VS Code to launch the Extension Development Host
2. Test your changes in the new VS Code window
3. Check the "DemoTyper" output channel for debug logs

### Code Style

- Use TypeScript for all source files
- Follow the existing code formatting (2-space indentation)
- Add comments for complex logic
- Use descriptive variable and function names
- Keep functions focused and reasonably sized

### Commit Messages

- Use clear, descriptive commit messages
- Start with a verb in present tense: "Add feature" not "Added feature"
- Reference issues when applicable: "Fix #123: Handle edge case"

Example:
```
feat: Add support for } catch same-line continuation

- Implement Closing-Prefix Match Guard
- Handle indent alignment before character fill
- Add tests for try-catch scenarios
```

## Project Structure

```
demotyper/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── secretModeHandler.ts  # Secret mode logic
│   ├── smartReplaceHandler.ts # Core diff algorithm
│   ├── targetFileManager.ts  # Target file handling
│   └── ...
├── docs/                     # Design documents
├── resources/                # Icons and assets
├── test/                     # Test files
└── package.json
```

### Key Files

- `smartReplaceHandler.ts` - The core Smart Replace algorithm with gap detection
- `secretModeHandler.ts` - Handles secret mode activation and input interception
- `targetFileManager.ts` - Manages target file snapshots

## Questions?

Feel free to open an issue with the "question" label if you have any questions about contributing.

Thank you for your contribution! 🎉
