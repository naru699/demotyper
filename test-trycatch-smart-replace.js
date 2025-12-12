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

function readFixture(fixturesDir, fileName) {
  const fullPath = path.join(fixturesDir, fileName);
  return fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
}

function simulateSmartReplace(current, target) {
  const targetManager = { readTargetContent: async () => undefined };
  const logger = { info: () => {}, dispose: () => {} };
  const notifications = { info: async () => undefined, warning: async () => undefined, error: async () => undefined };
  const handler = new SmartReplaceHandler(targetManager, logger, notifications);

  const maxIterations = 10000;
  let iter = 0;
  while (iter++ < maxIterations) {
    const diff = handler.computeNextGap(current, target);
    if (diff.state === 'inSync') {
      return current;
    }
    if (diff.state === 'mismatch') {
      throw new Error(`Mismatch at offset=${diff.offset}`);
    }

    const deleteCount = diff.deleteCount ?? 0;
    const before = current.slice(0, diff.insertOffset);
    const after = current.slice(diff.insertOffset + deleteCount);
    current = before + diff.nextChar + after;
  }
  throw new Error('Exceeded max iterations (possible dead loop)');
}

const fixturesDir = path.join(__dirname, 'test', 'e2e', 'trycatch');
const target = readFixture(fixturesDir, 'TryCatchService.full.ts');
const current = readFixture(fixturesDir, 'TryCatchService.missing.ts');

const finalDoc = simulateSmartReplace(current, target);
if (finalDoc !== target) {
  console.error('Final document does not match target.');
  process.exit(1);
}

console.log('✅ Try/catch fixture passed (no split on } catch / } else).');
process.exit(0);

