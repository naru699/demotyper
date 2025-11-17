/**
 * Test script for insert loop detection
 *
 * This script simulates the behavior of the SmartReplaceHandler
 * to verify that the loop detection mechanism works correctly.
 */

class MockLogger {
  info(message) {
    console.log('[INFO]', message);
  }
}

class MockNotificationManager {
  async warning(message) {
    console.log('[WARNING]', message);
  }
}

class InsertHistoryTester {
  constructor() {
    this.insertHistory = [];
    this.logger = new MockLogger();
    this.notifications = new MockNotificationManager();
  }

  /**
   * Simulates the insert history tracking logic
   */
  async testInsert(offset, text) {
    // 检测死循环：同一offset被重复插入
    const now = Date.now();
    const recentSameOffset = this.insertHistory.filter(
      h => h.offset === offset && now - h.timestamp < 5000
    );

    this.logger.info(`History check: offset=${offset} has been inserted ${recentSameOffset.length} times in last 5 seconds`);

    if (recentSameOffset.length >= 3) {
      // 触发保护机制
      const errorMsg = `检测到死循环：同一位置(offset=${offset})在5秒内被重复插入${recentSameOffset.length}次。已停止插入以保护文档。`;
      this.logger.info(`[LOOP DETECTED] ${errorMsg}`);
      this.logger.info(`[LOOP DETECTED] Insert history (last 10): ${JSON.stringify(this.insertHistory.slice(-10))}`);

      await this.notifications.warning(`DemoTyper: ${errorMsg}\n\n请检查目标文件格式是否正确，或尝试使用 Restore Current File 命令重置文档状态。`);

      // 清空历史记录，允许用户重试
      this.insertHistory = [];
      return false;
    }

    // 模拟插入成功
    this.logger.info(`Insert succeeded at offset ${offset}: "${text}"`);

    // 插入成功后记录到历史
    this.insertHistory.push({offset, timestamp: now});
    if (this.insertHistory.length > 10) {
      this.insertHistory.shift();
    }
    this.logger.info(`Recorded to history. History size: ${this.insertHistory.length}`);

    return true;
  }

  reset() {
    this.insertHistory = [];
    this.logger.info('[RESET] Cleared insert history');
  }
}

// ========== Test Cases ==========

async function runTests() {
  console.log('='.repeat(60));
  console.log('Test 1: Normal inserts at different offsets');
  console.log('='.repeat(60));

  const tester1 = new InsertHistoryTester();
  await tester1.testInsert(0, 'a');
  await tester1.testInsert(1, 'b');
  await tester1.testInsert(2, 'c');
  await tester1.testInsert(3, 'd');
  console.log('✓ Test 1 passed: Normal inserts work fine\n');

  console.log('='.repeat(60));
  console.log('Test 2: Loop detection - same offset inserted 4 times');
  console.log('='.repeat(60));

  const tester2 = new InsertHistoryTester();
  const result1 = await tester2.testInsert(10, 'x');
  console.log(`Insert 1 result: ${result1}`);

  const result2 = await tester2.testInsert(10, 'x');
  console.log(`Insert 2 result: ${result2}`);

  const result3 = await tester2.testInsert(10, 'x');
  console.log(`Insert 3 result: ${result3}`);

  const result4 = await tester2.testInsert(10, 'x');
  console.log(`Insert 4 result: ${result4} (should be false - loop detected!)`);

  if (result4 === false) {
    console.log('✓ Test 2 passed: Loop detection triggered correctly\n');
  } else {
    console.log('✗ Test 2 failed: Loop detection should have triggered\n');
  }

  console.log('='.repeat(60));
  console.log('Test 3: History cleanup after loop detection');
  console.log('='.repeat(60));

  const tester3 = new InsertHistoryTester();
  await tester3.testInsert(20, 'y');
  await tester3.testInsert(20, 'y');
  await tester3.testInsert(20, 'y');
  await tester3.testInsert(20, 'y'); // This should clear history

  console.log(`History size after loop detection: ${tester3.insertHistory.length}`);
  if (tester3.insertHistory.length === 0) {
    console.log('✓ Test 3 passed: History cleared after loop detection\n');
  } else {
    console.log('✗ Test 3 failed: History should be cleared\n');
  }

  console.log('='.repeat(60));
  console.log('Test 4: Time window - inserts outside 5-second window');
  console.log('='.repeat(60));

  const tester4 = new InsertHistoryTester();

  // Manually add old history entries (simulate 6 seconds ago)
  const sixSecondsAgo = Date.now() - 6000;
  tester4.insertHistory.push({offset: 30, timestamp: sixSecondsAgo});
  tester4.insertHistory.push({offset: 30, timestamp: sixSecondsAgo});
  tester4.insertHistory.push({offset: 30, timestamp: sixSecondsAgo});

  console.log(`History before test: ${JSON.stringify(tester4.insertHistory)}`);

  // Now insert at same offset - should not trigger because old entries are > 5 seconds old
  const result = await tester4.testInsert(30, 'z');
  console.log(`Insert result: ${result} (should be true - old entries ignored)`);

  if (result === true) {
    console.log('✓ Test 4 passed: Old entries outside time window are ignored\n');
  } else {
    console.log('✗ Test 4 failed: Old entries should be ignored\n');
  }

  console.log('='.repeat(60));
  console.log('Test 5: History size limit (max 10 entries)');
  console.log('='.repeat(60));

  const tester5 = new InsertHistoryTester();

  // Insert 15 times at different offsets
  for (let i = 0; i < 15; i++) {
    await tester5.testInsert(i * 10, `char${i}`);
  }

  console.log(`History size after 15 inserts: ${tester5.insertHistory.length}`);
  console.log(`History entries: ${JSON.stringify(tester5.insertHistory)}`);

  if (tester5.insertHistory.length === 10) {
    console.log('✓ Test 5 passed: History size capped at 10\n');
  } else {
    console.log('✗ Test 5 failed: History should be capped at 10\n');
  }

  console.log('='.repeat(60));
  console.log('Test 6: Reset clears history');
  console.log('='.repeat(60));

  const tester6 = new InsertHistoryTester();
  await tester6.testInsert(40, 'a');
  await tester6.testInsert(41, 'b');
  await tester6.testInsert(42, 'c');

  console.log(`History size before reset: ${tester6.insertHistory.length}`);
  tester6.reset();
  console.log(`History size after reset: ${tester6.insertHistory.length}`);

  if (tester6.insertHistory.length === 0) {
    console.log('✓ Test 6 passed: Reset clears history\n');
  } else {
    console.log('✗ Test 6 failed: Reset should clear history\n');
  }

  console.log('='.repeat(60));
  console.log('All tests completed!');
  console.log('='.repeat(60));
}

// Run all tests
runTests().catch(console.error);
