import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  // 创建 Mocha 测试
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 60000, // 60秒超时，给 VS Code 扩展足够的加载时间
  });

  const testsRoot = path.resolve(__dirname, '.');

  // 使用新版 glob API (Promise-based)
  const files = await glob('**/**.test.js', { cwd: testsRoot });

  // 添加所有测试文件到测试套件
  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise<void>((resolve, reject) => {
    try {
      // 运行 Mocha 测试
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
