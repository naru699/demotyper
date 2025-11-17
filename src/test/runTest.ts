import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    // 开发扩展所在的文件夹
    // 传递给 --extensionDevelopmentPath
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // 测试运行器的路径
    // 传递给 --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // 下载 VS Code，解压并运行集成测试
    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err) {
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();
