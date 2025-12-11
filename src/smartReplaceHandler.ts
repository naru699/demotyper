import * as vscode from 'vscode';
import { TargetFileManager } from './targetFileManager';
import { Logger } from './logger';
import { SmartReplaceResult, UndoFriendlyEditOptions } from './types';
import { NotificationManager } from './notificationManager';

export class SmartReplaceHandler {
  private documentSnapshot?: { version: number; text: string };
  private insertHistory: Array<{ offset: number; text: string; deleteCount: number; timestamp: number }> = [];
  private lastInsertAttempt?: { offset: number; text: string; deleteCount: number };
  private repeatedInsertCount = 0;
  private placeholderClosings: number[] = []; // sorted array of offsets for auto-paired closings (shift-aware)
  private readonly maxRepeatedInsertAttempts = 3;
  private lastDocumentLength = 0; // 用于检测进度停滞
  private stagnantInsertCount = 0; // 文档长度未变化的连续插入次数

  constructor(
    private readonly targetFileManager: TargetFileManager,
    private readonly logger: Logger,
    private readonly notifications: NotificationManager,
  ) {}

  async handleType(
    editor: vscode.TextEditor,
    typedText: string | undefined,
    editOptionsFactory: () => UndoFriendlyEditOptions,
  ): Promise<SmartReplaceResult> {
    const targetContent = await this.targetFileManager.readTargetContent(editor.document.uri);
    if (targetContent === undefined) {
      return 'targetMissing';
    }

    const currentContent = this.getDocumentText(editor);
    const analysis = this.analyzeDocumentState(editor, currentContent, targetContent);
    if (analysis.state === 'inSync') {
      return 'inSync';
    }
    if (analysis.state === 'mismatch') {
      this.logger.info(`Smart replace out-of-sync at offset ${analysis.offset}`);
      await this.notifications.warning('DemoTyper: 当前内容与目标文件不一致，光标已移动到需要补写的位置。请先使用 Restore Current File 纠正格式化差异。');
      this.moveCursorTo(editor, analysis.offset);
      return 'outOfSync';
    }

    const { insertOffset, nextChar, cursorBackOffset, deleteCount } = analysis;

    const editOptions = editOptionsFactory();

    // 将要插入的字符转换为文档的 EOL 格式
    const textToInsert = this.convertToDocumentEOL(editor, nextChar);
    const adjustedCursorBackOffset = this.adjustCursorBackOffsetForEOL(
      nextChar,
      textToInsert,
      cursorBackOffset,
    );

    const inserted = await this.insertAt(
      editor,
      insertOffset,
      textToInsert,
      editOptions,
      adjustedCursorBackOffset,
      deleteCount,
    );
    if (!inserted) {
      return 'outOfSync';
    }

    this.updateSnapshot(editor);
    return 'applied';
  }

  async jumpToNextGap(editor: vscode.TextEditor): Promise<void> {
    const targetContent = await this.targetFileManager.readTargetContent(editor.document.uri);
    if (targetContent === undefined) {
      return;
    }

    const currentContent = this.getDocumentText(editor);
    const analysis = this.analyzeDocumentState(editor, currentContent, targetContent);
    if (analysis.state === 'mismatch') {
      await this.notifications.warning('DemoTyper: 当前内容与目标文件不一致，光标已定位到偏差处。');
      this.moveCursorTo(editor, analysis.offset);
      return;
    }

    if (analysis.state === 'inSync') {
      await this.notifications.info('DemoTyper: No remaining differences.');
      return;
    }

    this.moveCursorTo(editor, analysis.insertOffset);
  }

  async showDebugInfo(editor: vscode.TextEditor): Promise<void> {
    const targetContent = await this.targetFileManager.readTargetContent(editor.document.uri);
    if (targetContent === undefined) {
      await this.notifications.warning('DemoTyper: No target file set.');
      return;
    }

    const currentContent = this.getDocumentText(editor);

    // 显示文件内容的前100个字符（用于调试）
    const currentPreview = this.getContentPreview(currentContent, 100);
    const targetPreview = this.getContentPreview(targetContent, 100);

    this.logger.info(`[DEBUG] Current content preview: ${currentPreview}`);
    this.logger.info(`[DEBUG] Target content preview: ${targetPreview}`);

    const analysis = this.analyzeDocumentState(editor, currentContent, targetContent);

    let message = '';
    if (analysis.state === 'inSync') {
      message = 'Status: In Sync\n文档与目标文件完全一致';
    } else if (analysis.state === 'mismatch') {
      message = `Status: Mismatch\n不匹配位置: offset ${analysis.offset}`;
    } else {
      const charDesc = this.getCharDescription(analysis.nextChar);
      message = `Status: Gap Found\n插入位置: offset ${analysis.insertOffset}\n下一个字符: ${charDesc}`;
    }

    const detailedMessage = `${message}\n\nCurrent (前50字符): ${this.getContentPreview(currentContent, 50)}\n\nTarget (前50字符): ${this.getContentPreview(targetContent, 50)}`;

    this.logger.info(`[DEBUG INFO] ${message}`);
    await vscode.window.showInformationMessage(
      `DemoTyper Debug Info:\n${detailedMessage}`,
      { modal: true }
    );
  }

  /**
   * 获取内容预览（将不可见字符转换为可读格式）
   */
  private getContentPreview(content: string, maxLength: number): string {
    const preview = content.substring(0, maxLength);
    let result = '';
    for (let i = 0; i < preview.length; i++) {
      const char = preview[i];
      if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else if (char.charCodeAt(0) < 32) {
        result += `<0x${char.charCodeAt(0).toString(16)}>`;
      } else {
        result += char;
      }
    }
    if (content.length > maxLength) {
      result += '...';
    }
    return result;
  }

  reset(): void {
    this.documentSnapshot = undefined;
    this.insertHistory = [];
    this.lastInsertAttempt = undefined;
    this.repeatedInsertCount = 0;
    this.placeholderClosings = [];
    this.lastDocumentLength = 0;
    this.stagnantInsertCount = 0;
    this.logger.info('[RESET] Cleared insert history and progress tracking');
  }

  /**
   * 通知外部删除操作，用于清理被删除的占位符并调整偏移量
   * @param deleteOffset 删除起始位置
   * @param deleteLength 删除长度
   */
  notifyDeletion(deleteOffset: number, deleteLength: number): void {
    if (this.placeholderClosings.length === 0 || deleteLength <= 0) {
      return;
    }

    const deleteEnd = deleteOffset + deleteLength;
    const newPlaceholders: number[] = [];

    for (const pOffset of this.placeholderClosings) {
      // 如果占位符在删除范围内，移除它
      if (pOffset >= deleteOffset && pOffset < deleteEnd) {
        this.logger.info(`[PLACEHOLDER] Cleanup (external delete): removed at offset ${pOffset}`);
        continue;
      }

      // 如果占位符在删除点之后，调整偏移量
      if (pOffset >= deleteEnd) {
        newPlaceholders.push(pOffset - deleteLength);
      } else {
        newPlaceholders.push(pOffset);
      }
    }

    this.placeholderClosings = newPlaceholders;
    this.logger.info(`[PLACEHOLDER] After external delete: array: [${this.placeholderClosings.join(', ')}]`);
  }

  private async insertAt(
    editor: vscode.TextEditor,
    offset: number,
    text: string,
    editOptions: UndoFriendlyEditOptions,
    cursorBackOffset?: number,
    deleteCount = 0,
  ): Promise<boolean> {
    let insertText = text;
    let effectiveCursorBackOffset = cursorBackOffset;
    const position = editor.document.positionAt(offset);

    // 检测是否需要自动配对，但延迟添加占位符到 Drift Correction 之后
    let isNewPairInsertion = false;
    let isSmartBlockExpansion = false; // 标记是否触发了智能代码块展开
    if (deleteCount === 0 && effectiveCursorBackOffset === undefined) {
      const pairInfo = this.getAutoPairInsertion(text);
      if (pairInfo) {
        insertText = pairInfo.text;
        effectiveCursorBackOffset = pairInfo.cursorBackOffset;
        isNewPairInsertion = insertText.length === 2 && insertText[0] !== insertText[1];
        this.logger.info(`[CROSS-LINE DEBUG] After auto-pair, char='${text}', next='${insertText}', cursorBack=${effectiveCursorBackOffset}, willAddPlaceholder=${isNewPairInsertion}`);

        // ===== 智能代码块展开检测 =====
        // 仅对 `{` 触发，检查 target 中 `{` 后是否紧跟换行符
        if (isNewPairInsertion && text === '{') {
          const targetContent = await this.targetFileManager.readTargetContent(editor.document.uri);
          if (targetContent !== undefined) {
            const targetNormalized = this.normalizeLineEndings(targetContent);
            // offset 是在 current 文档中的位置，由于 analyzeDocumentState 确保在 offset 之前两者匹配
            // 所以在 target 中对应位置也是这个 offset
            const expandedText = this.detectSmartBraceExpansion(editor, targetNormalized, offset);
            if (expandedText !== undefined) {
              insertText = expandedText;
              // 光标回退 1 个字符，落在 `}` 之前（缩进行末尾）
              effectiveCursorBackOffset = 1;
              isSmartBlockExpansion = true;
              this.logger.info(`[SMART BLOCK] Overriding insertText to expanded block`);
            }
          }
        }
        // ===== 智能代码块展开检测结束 =====
      }
    }

    const charDesc = this.getCharDescription(insertText);
    const now = Date.now();

    const isPlaceholderClosing = this.placeholderClosings.includes(offset) && this.isAutoPairClosingChar(insertText);

    // 检测死循环：同一offset+文本被连续插入（占位闭符不计入）
    if (
      !isPlaceholderClosing &&
      this.lastInsertAttempt &&
      this.lastInsertAttempt.offset === offset &&
      this.lastInsertAttempt.text === insertText &&
      this.lastInsertAttempt.deleteCount === deleteCount
    ) {
      this.repeatedInsertCount++;
      this.logger.info(`[INSERT] Repeated insert attempt #${this.repeatedInsertCount} for ${charDesc} at offset ${offset}`);
      if (this.repeatedInsertCount >= this.maxRepeatedInsertAttempts) {
        const errorMsg = `检测到死循环：同一内容(${charDesc})在 offset=${offset} 连续插入 ${this.repeatedInsertCount} 次。已停止插入以保护文档。`;
        this.logger.info(`[INSERT LOOP DETECTED] ${errorMsg}`);
        await this.notifications.warning(`DemoTyper: ${errorMsg}\n\n请检查目标文件格式是否正确，或尝试使用 Restore Current File 命令重置文档状态。`);
        this.lastInsertAttempt = undefined;
        this.repeatedInsertCount = 0;
        return false;
      }
    } else {
      this.repeatedInsertCount = 0;
      this.lastInsertAttempt = { offset, text: insertText, deleteCount };
    }

      // 检测死循环：同一offset被频繁插入（占位闭符不计入）
      const recentSameOffset = this.insertHistory.filter(
        (h) =>
          h.offset === offset &&
          h.text === insertText &&
          h.deleteCount === deleteCount &&
          now - h.timestamp < 5000 &&
          !(isPlaceholderClosing && this.isAutoPairClosingChar(h.text)),
      );

    if (recentSameOffset.length >= 3) {
      // 触发保护机制
      const errorMsg = `检测到死循环：同一位置(offset=${offset})在5秒内被重复插入${recentSameOffset.length}次。已停止插入以保护文档。`;
      this.logger.info(`[INSERT LOOP DETECTED] ${errorMsg}`);
      this.logger.info(`[INSERT LOOP DETECTED] Insert history (last 10): ${JSON.stringify(this.insertHistory.slice(-10))}`);

      await this.notifications.warning(`DemoTyper: ${errorMsg}\n\n请检查目标文件格式是否正确，或尝试使用 Restore Current File 命令重置文档状态。`);

      // 清空历史记录，允许用户重试
      this.insertHistory = [];
      this.lastInsertAttempt = undefined;
      this.repeatedInsertCount = 0;
      return false;
    }

    // 记录插入前文档内容
    const beforeText = editor.document.getText();

    const deleteEndPosition = deleteCount > 0 ? editor.document.positionAt(offset + deleteCount) : position;
    const applied = await editor.edit(
      (editBuilder) => {
        if (deleteCount > 0) {
          editBuilder.replace(new vscode.Range(position, deleteEndPosition), insertText);
        } else {
          editBuilder.insert(position, insertText);
        }
      },
      editOptions,
    );

    if (!applied) {
      return false;
    }

    const afterText = editor.document.getText();

    const actualInsertedLength = this.calculateInsertedLength(insertText, editor.document.eol);
    const defaultNewOffset = offset + actualInsertedLength;
    const normalizedBackOffset = effectiveCursorBackOffset ? Math.min(effectiveCursorBackOffset, actualInsertedLength) : 0;
    const finalCursorOffset = Math.max(offset, defaultNewOffset - normalizedBackOffset);

    const nextPosition = editor.document.positionAt(finalCursorOffset);
    editor.selection = new vscode.Selection(nextPosition, nextPosition);

    // 进度停滞检测：如果文档长度没有增长，计数器+1
    if (afterText.length <= this.lastDocumentLength && this.lastDocumentLength > 0) {
      this.stagnantInsertCount++;
      if (this.stagnantInsertCount >= 5) {
        const errorMsg = `检测到进度停滞：连续 ${this.stagnantInsertCount} 次插入后文档长度未增长。可能存在逻辑错误。`;
        this.logger.info(`[PROGRESS STALL DETECTED] ${errorMsg}`);
        await this.notifications.warning(`DemoTyper: ${errorMsg}\n\n请检查目标文件格式是否正确，或尝试使用 Restore Current File 命令重置文档状态。`);
        this.stagnantInsertCount = 0;
        return false;
      }
    } else {
      this.stagnantInsertCount = 0;
    }
    this.lastDocumentLength = afterText.length;

    // 插入成功后记录到历史
    this.insertHistory.push({ offset, text: insertText, deleteCount, timestamp: now });
    if (this.insertHistory.length > 10) {
      this.insertHistory.shift();
    }

    // Drift Correction & Cleanup: 更新或移除占位符偏移量
    // netChange = 插入长度 - 删除长度
    const netChange = actualInsertedLength - deleteCount;
    if (this.placeholderClosings.length > 0) {
      const deleteEnd = offset + deleteCount;
      const newPlaceholders: number[] = [];

      for (let i = 0; i < this.placeholderClosings.length; i++) {
        const pOffset = this.placeholderClosings[i];

        // Cleanup: 如果占位符在删除范围内，移除它
        if (deleteCount > 0 && pOffset >= offset && pOffset < deleteEnd) {
          this.logger.info(`[PLACEHOLDER] Cleanup: removed placeholder at offset ${pOffset} (was in delete range ${offset}-${deleteEnd})`);
          continue;
        }

        // Drift Correction: 如果占位符在修改点之后，调整偏移量
        if (pOffset > offset) {
          const newOffset = pOffset + netChange;
          if (newOffset >= 0) {
            newPlaceholders.push(newOffset);
          }
        } else {
          newPlaceholders.push(pOffset);
        }
      }

      this.placeholderClosings = newPlaceholders;
      if (netChange !== 0 || newPlaceholders.length !== this.placeholderClosings.length) {
        this.logger.info(`[PLACEHOLDER] After drift/cleanup: netChange=${netChange}, array: [${this.placeholderClosings.join(', ')}]`);
      }
    }

    // 添加新的占位符（在 Drift Correction 之后，避免被错误偏移）
    if (isNewPairInsertion) {
      // 计算闭合符 `}` / `)` / `]` 的偏移量
      // - 普通配对 (如 '{}')：闭符在 offset + 1
      // - 智能展开 (如 '{\n    }')：闭符在 offset + actualInsertedLength - 1
      const closingOffset = isSmartBlockExpansion
        ? offset + actualInsertedLength - 1
        : offset + 1;
      // 保持数组有序插入
      const insertIdx = this.placeholderClosings.findIndex(o => o > closingOffset);
      if (insertIdx === -1) {
        this.placeholderClosings.push(closingOffset);
      } else {
        this.placeholderClosings.splice(insertIdx, 0, closingOffset);
      }
      this.logger.info(`[PLACEHOLDER] Added new closing at offset ${closingOffset}${isSmartBlockExpansion ? ' (smart block)' : ''}, array: [${this.placeholderClosings.join(', ')}]`);
    }

    return true;
  }

  /**
   * 计算文本插入到文档后实际占用的字符数
   * 考虑EOL转换：在LF文档中插入\r\n会被规范化
   */
  private calculateInsertedLength(text: string, eol: vscode.EndOfLine): number {
    // 简单返回文本长度即可，因为：
    // 1. 如果我们插入的是\n，文档是LF，长度=1
    // 2. 如果我们插入的是\r\n，文档是CRLF，长度=2
    // 3. convertToDocumentEOL已经处理了转换，所以text已经是正确的格式
    return text.length;
  }

  /**
   * 将规范化文本中的删除长度转换为原始文本中的字符数
   */
  private calculateDeleteCountFromNormalized(
    normalizedStart: number,
    normalizedLength: number,
    mapping: number[],
  ): number {
    if (normalizedLength <= 0) {
      return 0;
    }
    const startOriginal = this.mapNormalizedToOriginal(normalizedStart, mapping);
    const endOriginal = this.mapNormalizedToOriginal(normalizedStart + normalizedLength, mapping);
    return Math.max(0, endOriginal - startOriginal);
  }

  private getDocumentText(editor: vscode.TextEditor): string {
    if (this.documentSnapshot?.version === editor.document.version) {
      return this.documentSnapshot.text;
    }
    return this.captureSnapshot(editor);
  }

  private captureSnapshot(editor: vscode.TextEditor): string {
    const text = editor.document.getText();
    this.documentSnapshot = { version: editor.document.version, text };
    return text;
  }

  private updateSnapshot(editor: vscode.TextEditor): void {
    this.documentSnapshot = { version: editor.document.version, text: editor.document.getText() };
  }

  private moveCursorTo(editor: vscode.TextEditor, offset: number): void {
    const position = editor.document.positionAt(offset);
    editor.selections = [new vscode.Selection(position, position)];
    editor.revealRange(new vscode.Range(position, position));
  }

  /**
   * 规范化文本中的换行符，将所有 \r\n 和 \r 转换为 \n
   */
  private normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  /**
   * 创建原始文本偏移量到规范化文本偏移量的映射
   */
  private createOffsetMapping(original: string): number[] {
    const mapping: number[] = [];
    let normalizedIdx = 0;

    for (let i = 0; i < original.length; i++) {
      mapping.push(normalizedIdx);

      // 如果是 \r\n，跳过 \r，只计算 \n
      if (original[i] === '\r' && i + 1 < original.length && original[i + 1] === '\n') {
        continue;
      }
      // 如果是单独的 \r，转换为 \n
      if (original[i] === '\r') {
        normalizedIdx++;
      } else {
        normalizedIdx++;
      }
    }

    // 添加末尾位置的映射
    mapping.push(normalizedIdx);

    return mapping;
  }

  /**
   * 将规范化的偏移量转换回原始文本的偏移量
   */
  private mapNormalizedToOriginal(normalizedOffset: number, mapping: number[]): number {
    for (let i = 0; i < mapping.length; i++) {
      if (mapping[i] === normalizedOffset) {
        return i;
      }
      if (mapping[i] > normalizedOffset) {
        return Math.max(0, i - 1);
      }
    }
    return Math.max(0, mapping.length - 1);
  }

  /**
   * 使用基于行的 diff，找出需要插入的字符
   * 仍然是逐字符输入，但基于行来判断插入位置
   * @returns 'inSync' | 'gap' | 'mismatch'
   */
  private computeNextGap(
    current: string,
    target: string,
  ):
    | { state: 'inSync' }
    | { state: 'gap'; insertOffset: number; nextChar: string; cursorBackOffset?: number; deleteCount?: number }
    | { state: 'mismatch'; offset: number } {
    // 规范化换行符
    const normalizedCurrent = this.normalizeLineEndings(current);
    const normalizedTarget = this.normalizeLineEndings(target);

    // 按行分割
    // 注意：split('\n') 会将 "a\nb\n" 分割为 ["a", "b", ""]（末尾空字符串）
    // 为了正确处理尾部换行符，我们需要区分：
    // - "a\nb" (无尾部换行) → ["a", "b"]
    // - "a\nb\n" (有尾部换行) → ["a", "b", ""]
    const currentLines = normalizedCurrent.split('\n');
    const targetLines = normalizedTarget.split('\n');

    this.logger.info(`[DEBUG] Current lines: ${currentLines.length}, Target lines: ${targetLines.length}`);

    // 创建偏移量映射
    const currentMapping = this.createOffsetMapping(current);

    // 如果检测到占位符行（例如 [DELETED] 标记），优先删除
    const placeholderLineIndex = currentLines.findIndex((line) => this.isPlaceholderDeletionLine(line));
    if (placeholderLineIndex !== -1) {
      const placeholderStartOffset = this.getLineStartOffset(normalizedCurrent, placeholderLineIndex);
      const originalOffset = this.mapNormalizedToOriginal(placeholderStartOffset, currentMapping);
      const deleteCount = this.calculateDeleteCountFromNormalized(
        placeholderStartOffset,
        currentLines[placeholderLineIndex].length,
        currentMapping,
      );
      this.logger.info(`[DEBUG] Found placeholder line at index ${placeholderLineIndex}, removing it before continuing`);
      return {
        state: 'gap',
        insertOffset: originalOffset,
        nextChar: '',
        deleteCount: deleteCount > 0 ? deleteCount : undefined,
      };
    }

    // 逐行比对
    let currentLineIndex = 0;
    let targetLineIndex = 0;

    // 添加安全计数器防止无限循环
    const maxIterations = targetLines.length + currentLines.length + 100;
    let iterations = 0;

    // 跟踪上一次迭代的索引，用于检测死循环
    let lastCurrentIndex = -1;
    let lastTargetIndex = -1;
    let stuckCount = 0; // 连续停滞的次数

    while (targetLineIndex < targetLines.length) {
      // 检查是否超过最大迭代次数
      if (++iterations > maxIterations) {
        this.logger.info(`[ERROR] computeNextGap exceeded ${maxIterations} iterations - possible infinite loop`);
        this.logger.info(`[ERROR] State: currentLineIndex=${currentLineIndex}, targetLineIndex=${targetLineIndex}`);
        return { state: 'mismatch', offset: 0 };
      }

      // 检测死循环：如果索引连续3次没有变化，强制中断
      if (lastCurrentIndex === currentLineIndex && lastTargetIndex === targetLineIndex) {
        stuckCount++;
        if (stuckCount >= 3) {
          this.logger.info(`[ERROR] Detected infinite loop: indices stuck at currentLineIndex=${currentLineIndex}, targetLineIndex=${targetLineIndex} for ${stuckCount} iterations`);
          this.logger.info(`[DEBUG] Current line: "${currentLines[currentLineIndex] || '<EOF>'}"`);
          this.logger.info(`[DEBUG] Target line: "${targetLines[targetLineIndex]}"`);

          // 强制返回gap状态，在当前位置插入换行符
          const lineStartOffset = this.getLineStartOffset(normalizedCurrent, Math.min(currentLineIndex, currentLines.length - 1));
          const originalOffset = this.mapNormalizedToOriginal(lineStartOffset, currentMapping);
          const leadingSpaces = this.getLeadingSpaces(targetLines[targetLineIndex]);

          this.logger.info(`[FIX] Breaking loop by inserting newline at offset ${originalOffset}`);
          return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
        }
      } else {
        // 索引有变化，重置计数器
        stuckCount = 0;
      }

      // 记录当前索引
      lastCurrentIndex = currentLineIndex;
      lastTargetIndex = targetLineIndex;

      const targetLine = targetLines[targetLineIndex];

      // 如果 current 已经没有更多行了
      if (currentLineIndex >= currentLines.length) {
        // 需要在文档末尾追加新行
        // 插入位置是上一行的末尾
        const insertOffset = normalizedCurrent.length;
        const originalOffset = this.mapNormalizedToOriginal(insertOffset, currentMapping);

        // 获取目标行的缩进
        const leadingSpaces = this.getLeadingSpaces(targetLine);

        this.logger.info(`[DEBUG] Need to append line ${targetLineIndex}: "${targetLine}"`);
        this.logger.info(`[DEBUG] Insert newline + ${leadingSpaces.length} indent chars at offset ${originalOffset}`);

        return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
      }

    const currentLine = currentLines[currentLineIndex];

    // 比对当前行
    if (currentLine === targetLine) {
      // 这一行内容匹配，但需要检查是否需要在行末插入换行符
        // 计算这一行在文档中的起始偏移量
        const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
        const lineEndOffset = lineStartOffset + currentLine.length;

        // 检查是否需要插入换行符
        if (targetLineIndex < targetLines.length - 1) {
          // 目标文件后面还有更多行
          if (currentLineIndex + 1 < currentLines.length) {
            // Current也有下一行，检查是否匹配
            const nextCurrentLine = currentLines[currentLineIndex + 1];
            const nextTargetLine = targetLines[targetLineIndex + 1];

            if (nextCurrentLine !== nextTargetLine) {
              const nextCurrentTrimmed = nextCurrentLine.trim();
              // 如果当前下一行本身就是空白（仅缩进），不要触发向前查找。
              // 这类空白行会在后续字符比对阶段逐步填充，避免误判导致重复插入换行。
              if (nextCurrentTrimmed.length === 0) {
                this.logger.info('[DEBUG] Next current line is whitespace only; skip lookahead to avoid duplicate newline insertion');
              } else if (nextCurrentTrimmed.length < this.getLineEffectiveLength(nextTargetLine) * 0.5) {
                // 当前下一行还远未达到目标行长度的一半，说明仍在逐字符填充，暂不触发向前查找
                this.logger.info('[DEBUG] Next current line still under half of target content; skip lookahead to continue filling characters');
              } else {
                // 下一行不匹配，向前查找：nextCurrentLine 是否匹配 target 的后续行
                // 增加查找范围到30行，并使用灵活匹配（忽略尾部空白和注释）
                let foundInLaterTarget = false;
                let matchedTargetIndex = -1;
                const maxLookAhead = 30;

                for (let i = targetLineIndex + 2; i < Math.min(targetLineIndex + 2 + maxLookAhead, targetLines.length); i++) {
                  const candidate = targetLines[i];
                  if (candidate.trim().length === 0) {
                    continue; // 空白行不参与向前匹配，避免无限插入空行
                  }
                  // 先尝试严格匹配，再尝试灵活匹配
                  if (nextCurrentLine === candidate ||
                      this.linesEssentiallyMatch(nextCurrentLine, candidate)) {
                    foundInLaterTarget = true;
                    matchedTargetIndex = i;
                    this.logger.info(`[DEBUG] Current[${currentLineIndex + 1}] matches Target[${i}] (distance: ${i - (targetLineIndex + 1)}), indicating Target[${targetLineIndex + 1}] is missing`);
                    break;
                  }
                }

                if (foundInLaterTarget) {
                  // Current的下一行匹配Target的更后面的行，说明中间缺行
                  const originalOffset = this.mapNormalizedToOriginal(lineEndOffset, currentMapping);

                  const missingLineCount = matchedTargetIndex - (targetLineIndex + 1);
                  this.logger.info(`[DEBUG] Line ${targetLineIndex} matches, but next line mismatch indicates ${missingLineCount} missing line(s)`);
                  this.logger.info(`[DEBUG] Current next line matches Target[${matchedTargetIndex}], so Target[${targetLineIndex + 1}] to Target[${matchedTargetIndex - 1}] are missing`);

                  // 插入换行符 + 缺失行的缩进
                  const nextTargetLine = targetLines[targetLineIndex + 1];
                  const leadingSpaces = this.getLeadingSpaces(nextTargetLine);
                  this.logger.info(`[DEBUG] Insert newline + ${leadingSpaces.length} indent chars at offset ${originalOffset}`);
                  return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
                } else {
                  // 没有在附近找到匹配，可能是大范围的行变化
                  // 不做处理，继续到下一轮逐字符比对
                  this.logger.info(`[DEBUG] Next line mismatch, but no nearby match found (checked ${maxLookAhead} lines ahead)`);
                  this.logger.info(`[DEBUG] Will continue with character-by-character comparison`);
                }
              }
            }
          } else {
            // Current没有下一行，但Target有，需要追加
            const originalOffset = this.mapNormalizedToOriginal(lineEndOffset, currentMapping);

            // 获取目标文件下一行的前导空格（缩进）
            const nextTargetLine = targetLines[targetLineIndex + 1];
            const leadingSpaces = this.getLeadingSpaces(nextTargetLine);

            this.logger.info(`[DEBUG] Line ${targetLineIndex} matches, but need to append more lines`);
            this.logger.info(`[DEBUG] Insert newline + ${leadingSpaces.length} indent chars at offset ${originalOffset}`);
            return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
          }
        }

        // 这一行匹配，继续下一行
        currentLineIndex++;
        targetLineIndex++;
        continue;
      }

    // 行不匹配 - 找出差异
    this.logger.info(`[DEBUG] Line ${targetLineIndex} mismatch:`);
    this.logger.info(`[DEBUG]   Current[${currentLineIndex}]: "${currentLine}"`);
    this.logger.info(`[DEBUG]   Target[${targetLineIndex}]: "${targetLine}"`);

    // 特殊处理：当前行是目标行的前缀但包含额外语句（如多语句合并在一行）
    if (currentLine.startsWith(targetLine) && currentLine.length > targetLine.length) {
      const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
      const lineEndOffset = lineStartOffset + targetLine.length;
      const originalOffset = this.mapNormalizedToOriginal(lineEndOffset, currentMapping);
      const nextTargetLine = targetLines[targetLineIndex + 1] ?? '';
      const leadingSpaces = this.getLeadingSpaces(nextTargetLine);

      this.logger.info('[DEBUG] Current line is a prefix of target line but has extra content; inserting newline to split it');
      // 仍然只插入换行+缩进（符号以外不批量写入）
      return {
        state: 'gap',
        insertOffset: originalOffset,
        nextChar: '\n' + leadingSpaces,
      };
    }

    // 特殊处理：当前行末尾有占位符闭合符号（如自动配对的 } ) ]），需要在闭合符之前继续填充
    // 场景：当前 "if (!this.messageCallback)}" 目标 "if (!this.messageCallbacks.has(type)) {"
    // 需要找到第一个不匹配的位置，在那里插入缺失的字符
    const currentTrimmedEnd = currentLine.trimEnd();
    if (currentTrimmedEnd.length > 0) {
      // 从末尾向前查找连续的闭合符号
      let trailingClosingCount = 0;
      for (let i = currentTrimmedEnd.length - 1; i >= 0; i--) {
        if (this.isAutoPairClosingChar(currentTrimmedEnd[i])) {
          trailingClosingCount++;
        } else {
          break;
        }
      }

      if (trailingClosingCount > 0) {
        // 去掉末尾所有闭合符后的内容
        const currentWithoutClosings = currentTrimmedEnd.substring(0, currentTrimmedEnd.length - trailingClosingCount);
        const targetTrimmed = targetLine.trimEnd();

        this.logger.info(`[DEBUG] Found ${trailingClosingCount} trailing closing char(s), currentWithoutClosings="${currentWithoutClosings}"`);

        // ===== High-Priority Guard: Split & Retreat for Empty Lines =====
        // 如果当前行（去掉闭合符后）只有空白字符，且目标行有实际内容
        // 必须先拆行，将占位符推到下一行，而不是直接插入字符
        if (currentWithoutClosings.trim().length === 0 && targetTrimmed.length > 0) {
          // 检查目标行是否也是纯闭合符号行
          const targetIsClosingOnly = targetTrimmed.split('').every(c => this.isAutoPairClosingChar(c));

          if (!targetIsClosingOnly) {
            // 目标有实际内容，必须拆行
            const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
            const currentIndent = this.getLeadingSpaces(currentLine);
            const insertPos = lineStartOffset + currentIndent.length;
            const originalOffset = this.mapNormalizedToOriginal(insertPos, currentMapping);

            // 构建插入文本：换行 + 缩进
            const insertText = '\n' + currentIndent;

            this.logger.info(`[GAP-FIX] High-Priority: Trailing closing on whitespace-only line. Splitting & Retreating.`);
            this.logger.info(`[GAP-FIX] Current: "${currentLine}" | Target: "${targetLine.substring(0, 40)}..."`);
            this.logger.info(`[GAP-FIX] Inserting newline + indent(${currentIndent.length}), cursorBackOffset=${insertText.length}`);

            return {
              state: 'gap',
              insertOffset: originalOffset,
              nextChar: insertText,
              cursorBackOffset: insertText.length,
            };
          }
        }
        // ===== High-Priority Guard End =====

        // 场景 A: 当前行（去掉闭合符）是目标行的前缀，说明闭合符是占位符
        if (currentWithoutClosings.length > 0 &&
            targetTrimmed.startsWith(currentWithoutClosings) &&
            currentWithoutClosings.length < targetTrimmed.length) {
          const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
          const insertPos = lineStartOffset + currentWithoutClosings.length;
          const originalOffset = this.mapNormalizedToOriginal(insertPos, currentMapping);

          // 找出下一个要插入的字符
          const nextCharIdx = currentWithoutClosings.length;
          const nextChar = targetTrimmed[nextCharIdx];

          // 严格检查：只有当目标字符不是闭合符时才插入
          // 如果目标字符也是闭合符，说明占位符位置正确，不需要插入
          if (!this.isAutoPairClosingChar(nextChar)) {
            this.logger.info(`[DEBUG] Placeholder detected: inserting '${nextChar}' before trailing closings at offset ${originalOffset}`);
            return { state: 'gap', insertOffset: originalOffset, nextChar };
          }
        }

        // 场景 B: 当前行只有缩进+占位符闭合符（如 "    }"），而目标行有实际内容（如 "    stmt;"）
        // 这种情况下，占位符 } 应该属于后续行，需要在它之前插入换行符将占位符推下去
        if (currentWithoutClosings.length === 0 && targetTrimmed.length > 0) {
          // 整行只有缩进和闭合符号
          const currentIndent = this.getLeadingSpaces(currentLine);

          // 检查目标行是否也是闭合符号行（如 "    }" vs "    }"）
          // 如果是，说明匹配的是同一个闭合符，不需要额外插入
          if (targetTrimmed.split('').every(c => this.isAutoPairClosingChar(c))) {
            // 目标行也只有闭合符号，检查是否匹配
            this.logger.info(`[DEBUG] Both current and target are closing-only lines`);
            // 继续下面的逐字符比对
          } else {
            // ===== Split & Retreat Fix =====
            // 目标行有实际内容，而当前行只有占位符
            // 正确做法：先插入换行符，将占位符推到下一行，然后光标回退
            // 这样下一次击键时，代码会写在空行上，占位符在下面
            const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
            // 插入位置在缩进之后，占位符之前
            const insertPos = lineStartOffset + currentIndent.length;
            const originalOffset = this.mapNormalizedToOriginal(insertPos, currentMapping);

            // 构建插入文本：换行 + 当前行缩进（占位符保持原缩进）
            const insertText = '\n' + currentIndent;

            this.logger.info(`[GAP-FIX] Trailing closing detected on placeholder-only line. Splitting & Retreating.`);
            this.logger.info(`[GAP-FIX] Current: "${currentLine}" | Target: "${targetLine.substring(0, 40)}..."`);
            this.logger.info(`[GAP-FIX] Inserting newline + indent(${currentIndent.length}) at offset ${originalOffset}, cursorBackOffset=${insertText.length}`);

            return {
              state: 'gap',
              insertOffset: originalOffset,
              nextChar: insertText,
              cursorBackOffset: insertText.length,
            };
            // ===== Split & Retreat Fix End =====
          }
        }
      }
    }

      if (this.isPlaceholderDeletionLine(currentLine)) {
        const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
        const originalOffset = this.mapNormalizedToOriginal(lineStartOffset, currentMapping);
        const deleteCount = this.calculateDeleteCountFromNormalized(lineStartOffset, currentLine.length, currentMapping);
        this.logger.info(`[DEBUG] Placeholder marker detected at line ${currentLineIndex}, deleting placeholder line before inserting target content`);
        return {
          state: 'gap',
          insertOffset: originalOffset,
          nextChar: '',
          deleteCount: deleteCount > 0 ? deleteCount : undefined,
        };
      }

      // 特殊处理：检测是否删除了代码块（如if{}, for{}, while{}等）
      // 这种情况下，目标有多行内容，但当前只有一行闭合符号
      const isBlockDeletion = this.detectBlockDeletion(
        currentLineIndex,
        targetLineIndex,
        currentLines,
        targetLines
      );

      if (isBlockDeletion) {
        this.logger.info(`[DEBUG] Detected block deletion (e.g., if{}, for{} block removed)`);

        // 在当前行之前插入目标行
        const currentLineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
        const originalOffset = this.mapNormalizedToOriginal(currentLineStartOffset, currentMapping);

        // 查找当前行在目标文件中匹配的位置，计算缺失的行数
        const maxLookAhead = 30;
        let missingLineCount = 1; // 默认至少缺失1行
        let matchedTargetIndex = targetLineIndex + 1;

        for (let futureTargetIdx = targetLineIndex + 1;
             futureTargetIdx < Math.min(targetLineIndex + maxLookAhead + 1, targetLines.length);
             futureTargetIdx++) {
          if (currentLines[currentLineIndex] === targetLines[futureTargetIdx] ||
              this.linesEssentiallyMatch(currentLines[currentLineIndex], targetLines[futureTargetIdx])) {
            matchedTargetIndex = futureTargetIdx;
            missingLineCount = futureTargetIdx - targetLineIndex;
            break;
          }
        }

        this.logger.info(`[DEBUG] Block deletion: Current[${currentLineIndex}] matches Target[${matchedTargetIndex}], missing ${missingLineCount} lines`);

        // 插入换行符 + 目标行的缩进
        const leadingSpaces = this.getLeadingSpaces(targetLine);
        this.logger.info(`[DEBUG] Block deletion: Insert newline + ${leadingSpaces.length} indent chars at offset ${originalOffset}`);
        return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
      }

      // 检测是否需要插入新行（行数不匹配的情况）
      const isCurrentEmpty = currentLine.trim() === '';
      const isTargetEmpty = targetLine.trim() === '';

      // 情况1: 当前是空行，目标不是空行
      if (isCurrentEmpty && !isTargetEmpty) {
        // 检查当前行是否只有缩进（支持空格和制表符混合）
        const currentIndent = this.getLeadingSpaces(currentLine);
        const targetIndent = this.getLeadingSpaces(targetLine);

        // 如果当前行只有缩进字符，且少于目标行的缩进，一次性插入缺失的缩进
        if (currentLine === currentIndent && currentIndent.length < targetIndent.length) {
          const missingIndent = targetIndent.substring(currentIndent.length);
          const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
          const insertOffset = lineStartOffset + currentIndent.length;
          const originalOffset = this.mapNormalizedToOriginal(insertOffset, currentMapping);

          this.logger.info(`[DEBUG] Current line has ${currentIndent.length} indent chars, target needs ${targetIndent.length}`);
          this.logger.info(`[DEBUG] Insert ${missingIndent.length} indent chars at once (bulk-fill)`);

          return { state: 'gap', insertOffset: originalOffset, nextChar: missingIndent };
        }

        this.logger.info(`[DEBUG] Current line is empty, target is not empty, will fill character by character`);
        // 继续往下执行逐字符比对
      }
      // 情况2: 当前不是空行，且和目标行内容差异很大 → 需要在当前行前插入新行
      else if (!isCurrentEmpty && !isTargetEmpty) {
        // 首先检查行开头是否匹配(去除缩进后)
        const currentTrimmed = currentLine.trim();
        const targetTrimmed = targetLine.trim();
        const currentTrimmedLen = currentTrimmed.length;
        const targetTrimmedLen = targetTrimmed.length;
        // 对于 "()"/"{}" 之类的临时占位行，先继续补充内容，避免频繁插入换行导致死循环
        const looksLikePairSkeleton = currentTrimmedLen > 0 &&
          currentTrimmedLen <= 4 &&
          this.isPairSkeletonString(currentTrimmed);
        const stillFilling = targetTrimmedLen > 0 &&
          (currentTrimmedLen < targetTrimmedLen * 0.6 || looksLikePairSkeleton);

        // ⚠️ 重要: 只有当前行有实际内容时才做前缀检查
        // 如果当前行只有缩进(没有实际内容),说明是刚插入的空行,应该继续填充,不要再次插入换行
        if (!stillFilling && currentTrimmedLen > 0) {
          // 检查开头字符是否匹配(至少前3个字符或整个较短字符串)
          const checkLen = Math.min(3, currentTrimmedLen, targetTrimmedLen);
          const currentPrefix = currentTrimmed.substring(0, checkLen);
          const targetPrefix = targetTrimmed.substring(0, checkLen);

          if (checkLen > 0 && currentPrefix !== targetPrefix) {
            // 行开头就不匹配,说明是完全不同的行,需要在当前行前插入新行
            const currentLineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
            const originalOffset = this.mapNormalizedToOriginal(currentLineStartOffset, currentMapping);
            const leadingSpaces = this.getLeadingSpaces(targetLine);

            this.logger.info(`[DEBUG] Line prefix mismatch (current: "${currentPrefix}", target: "${targetPrefix}")`);
            this.logger.info(`[DEBUG] Current line: "${currentLine}"`);
            this.logger.info(`[DEBUG] Target line: "${targetLine}"`);
            this.logger.info(`[DEBUG] Insert newline + ${leadingSpaces.length} indent chars before current line at offset ${originalOffset}`);

            // 插入换行+目标行的缩进，让缺失行从新行开始逐字符补齐
            return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
          }
        } else if (stillFilling) {
          this.logger.info('[DEBUG] Current line is short/structural; skip prefix-based newline insertion to continue filling characters');
        }

        if (stillFilling) {
          // 当前行太短或仅有配对符，继续逐字符填充
          const threshold = (targetTrimmedLen * 0.6).toFixed(1);
          this.logger.info(`[DEBUG] Current line is still short (${currentTrimmedLen} < ${threshold}), continue filling`);
        } else {
          // 当前行已经有足够长度，进行相似度检测
          // 使用LCS算法计算相似度（对小的插入/删除更鲁棒）
          const similarity = this.calculateLineSimilarity(currentLine, targetLine);

          // 如果相似度小于50%，认为是不同的行，需要插入换行符
          if (similarity < 0.5) {
            const currentLineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
            const originalOffset = this.mapNormalizedToOriginal(currentLineStartOffset, currentMapping);

            // 获取目标文件当前行的前导空格（缩进）
            const leadingSpaces = this.getLeadingSpaces(targetLine);

            this.logger.info(`[DEBUG] Low LCS-based similarity detected: ${(similarity * 100).toFixed(1)}%`);
            this.logger.info(`[DEBUG] Current: "${currentLine.substring(0, 50)}${currentLine.length > 50 ? '...' : ''}"`);
            this.logger.info(`[DEBUG] Target:  "${targetLine.substring(0, 50)}${targetLine.length > 50 ? '...' : ''}"`);
            this.logger.info(`[DEBUG] Insert newline + ${leadingSpaces.length} indent chars before current line at offset ${originalOffset}`);

            return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
          }

          // 如果相似度>=50%，再检查"向前查找"：当前行是否匹配目标的后续行
          // 增加查找范围到30行，并使用灵活匹配
          if (similarity >= 0.5 && targetLineIndex + 1 < targetLines.length) {
            const maxLookAhead = 30;
            // 检查当前行是否匹配目标的后续某一行（查找附近30行，支持灵活匹配）
            for (
              let futureTargetIdx = targetLineIndex + 1;
              futureTargetIdx < Math.min(targetLineIndex + 1 + maxLookAhead, targetLines.length);
              futureTargetIdx++
            ) {
              const futureCandidate = targetLines[futureTargetIdx];
              if (futureCandidate.trim().length === 0) {
                continue; // 空白行不参与向前匹配，避免在空白块上重复插入换行
              }
              if (currentLine === futureCandidate ||
                  this.linesEssentiallyMatch(currentLine, futureCandidate)) {
                // 当前行匹配目标的后续行，说明目标的当前行在current中缺失
                const currentLineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
                const originalOffset = this.mapNormalizedToOriginal(currentLineStartOffset, currentMapping);

                const missingLineCount = futureTargetIdx - targetLineIndex;

                this.logger.info(`[DEBUG] Forward lookup: Current[${currentLineIndex}] matches Target[${futureTargetIdx}] (distance: ${missingLineCount})`);
                this.logger.info(`[DEBUG] This means Target[${targetLineIndex}] to Target[${futureTargetIdx - 1}] are missing (${missingLineCount} lines)`);

                // 插入换行符 + 目标行的缩进
                const leadingSpaces = this.getLeadingSpaces(targetLine);
                this.logger.info(`[DEBUG] Forward lookup: Insert newline + ${leadingSpaces.length} indent chars at offset ${originalOffset}`);
                return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
              }
            }
          }
        }
      }

      // 计算这一行在文档中的起始偏移量
      const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);

      // 逐字符比对找出差异 (Strict Matching)
      const maxLen = Math.max(currentLine.length, targetLine.length);
      for (let charIdx = 0; charIdx < maxLen; charIdx++) {
        const currentChar = currentLine[charIdx];
        const targetChar = targetLine[charIdx];
        const charOffset = lineStartOffset + charIdx;
        const originalOffset = this.mapNormalizedToOriginal(charOffset, currentMapping);

        // CASE 1: 字符匹配
        if (currentChar === targetChar && currentChar !== undefined) {
          // Strict Consumption: 如果匹配的字符是占位符，消费它
          const placeholderIdx = this.placeholderClosings.indexOf(originalOffset);
          if (placeholderIdx !== -1 && this.isAutoPairClosingChar(currentChar)) {
            this.placeholderClosings.splice(placeholderIdx, 1);
            this.logger.info(`[PLACEHOLDER] Consumed closing '${currentChar}' at offset ${originalOffset}, remaining: [${this.placeholderClosings.join(', ')}]`);
          }
          // 继续下一个字符
          continue;
        }

        // CASE 2: 字符不匹配 - 必须立即返回 GAP，绝不跳过！
        if (currentChar !== targetChar) {
          // [GAP-XRAY] 字符级不匹配诊断
          const xrayCurrentDesc = currentChar === undefined ? '<EOL>' : `'${currentChar}'`;
          const xrayTargetDesc = targetChar === undefined ? '<EOL>' : `'${targetChar}'`;
          const xrayPlaceholderHere = this.placeholderClosings.includes(originalOffset);
          this.logger.info(`[GAP-XRAY] MISMATCH @ line ${currentLineIndex}, char ${charIdx}: current=${xrayCurrentDesc}, target=${xrayTargetDesc}, isPlaceholderHere=${xrayPlaceholderHere}`);
          this.logger.info(`[GAP-XRAY] Line context: current="${currentLine.substring(0, 60)}${currentLine.length > 60 ? '...' : ''}" | target="${targetLine.substring(0, 60)}${targetLine.length > 60 ? '...' : ''}"`);

          // CASE 2a: 目标行已结束，当前行还有内容
          if (targetChar === undefined && currentChar !== undefined) {
            // 检查剩余内容是否全是占位符闭合符号
            const remainingContent = currentLine.substring(charIdx);
            const isAllClosingChars = remainingContent.length > 0 &&
              remainingContent.split('').every(c => this.isAutoPairClosingChar(c));

            if (isAllClosingChars) {
              // 剩余内容全是占位符，这行的目标内容已完成
              // 需要在占位符之前插入换行，将占位符推到下一行
              //
              // 关键：占位符的缩进应该使用当前行的缩进（因为占位符是从当前行分离出去的）
              // 而不是 target 下一行的缩进（那可能是块内容，缩进更深）
              if (targetLineIndex + 1 < targetLines.length) {
                // 使用当前行的缩进作为占位符的缩进
                const currentIndent = this.getLeadingSpaces(currentLine);
                // [GAP-XRAY] CASE 2a: Placeholder separation
                this.logger.info(`[GAP-XRAY] CASE 2a: Target line done, remaining "${remainingContent}" are placeholders`);
                this.logger.info(`[GAP-XRAY] CASE 2a: Inserting newline + indent(${currentIndent.length}) before placeholders at offset ${originalOffset}`);
                return {
                  state: 'gap',
                  insertOffset: originalOffset,
                  nextChar: '\n' + currentIndent,
                };
              }
              // 没有下一行，跳出循环检查是否同步
              this.logger.info(`[DEBUG] Target line done, remaining "${remainingContent}" are placeholders, no more target lines`);
              break;
            }

            // 有非占位符内容 - 这通常表示 mismatch
            // 但为了容错，我们可以尝试在额外内容前插入换行，使用当前行的缩进
            this.logger.info(`[DEBUG] Current line has extra non-placeholder content "${remainingContent}" at pos ${charIdx}`);
            this.logger.info(`[DEBUG] This is likely a mismatch, returning mismatch state`);
            return { state: 'mismatch', offset: originalOffset };
          }

          // CASE 2b: 目标还有字符，当前没有或不匹配

          // ===== Split Line Guard (防止 Sticky Bracket) =====
          // 场景：当前行只有缩进+占位符（如 "    }"），目标行有实际内容（如 "    if (..."）
          // 如果直接插入 targetChar，会导致 "    i}" -> "    if}" 的粘连问题
          // 正确做法：先插入换行符，把占位符推到下一行，然后再插入内容
          if (currentChar !== undefined &&
              this.isAutoPairClosingChar(currentChar) &&
              targetChar !== undefined &&
              targetChar !== '\n') {
            // 检查当前行在 charIdx 之前是否全是空白字符
            const beforeCursor = currentLine.substring(0, charIdx);
            const isBeforeCursorWhitespaceOnly = this.isWhitespaceOnly(beforeCursor);

            if (isBeforeCursorWhitespaceOnly) {
              // 触发拆行：在占位符前插入换行，将占位符推到下一行
              const currentIndent = this.getLeadingSpaces(currentLine);
              const insertText = '\n' + currentIndent;

              this.logger.info(`[GAP-FIX] Splitting placeholder-only line to prevent sticky brackets`);
              this.logger.info(`[GAP-FIX] Before: "${currentLine}" | Target: "${targetLine.substring(0, 40)}..."`);
              this.logger.info(`[GAP-FIX] Inserting newline + indent(${currentIndent.length}) at offset ${originalOffset}, cursorBackOffset=${insertText.length}`);

              // 关键：设置 cursorBackOffset = insertText.length
              // 这样光标会回退到插入点之前，即停留在上一行末尾
              // 而不是跟着跳到下一行紧贴 `}`
              return {
                state: 'gap',
                insertOffset: originalOffset,
                nextChar: insertText,
                cursorBackOffset: insertText.length,
              };
            }
          }
          // ===== Split Line Guard End =====

          // 标准处理：插入 targetChar，把占位符"推向右边"
          const nextChar = targetChar || '';
          const charDesc = this.getCharDescription(nextChar);

          // [GAP-XRAY] Scenario B - Push Logic
          this.logger.info(`[GAP-XRAY] SCENARIO B (Push): Inserting '${charDesc}' at offset ${originalOffset}`);
          this.logger.info(`[GAP-XRAY] Push will shift placeholders right. Current placeholders: [${this.placeholderClosings.join(', ')}]`);

          return { state: 'gap', insertOffset: originalOffset, nextChar };
        }
      }

      // [GAP-XRAY] 决策区：字符循环结束，所有字符都匹配
      this.logger.info(`[GAP-XRAY] DECISION ZONE: Loop ended for line ${currentLineIndex}. currentLine.len=${currentLine.length}, targetLine.len=${targetLine.length}`);
      this.logger.info(`[GAP-XRAY] Placeholders: [${this.placeholderClosings.join(', ')}]`);

      // 如果到这里，说明逐字符比对后所有字符都匹配了
      // 但需要检查是否需要在行末插入换行符
      if (targetLineIndex < targetLines.length - 1) {
        // 目标文件中该行后面还有更多行，需要插入换行符
        const lineEndOffset = lineStartOffset + targetLine.length;
        let insertOffset = lineEndOffset;

        // 检查当前行在目标行长度之后是否还有占位符闭合符号
        // 如果有，应该在闭合符之前插入换行，而不是在行末
        if (currentLine.length > targetLine.length) {
          const extraContent = currentLine.substring(targetLine.length);
          const extraTrimmed = extraContent.trim();
          // 如果多余内容只是闭合符号，在它之前插入换行
          if (extraTrimmed.length > 0 && this.isAutoPairClosingChar(extraTrimmed[0])) {
            this.logger.info(`[DEBUG] Found placeholder closing '${extraTrimmed[0]}' after target content; inserting newline before it`);
            // insertOffset 保持在 targetLine.length 的位置，即闭合符之前
          }
        }

        const originalOffset = this.mapNormalizedToOriginal(insertOffset, currentMapping);

        // 获取下一行的缩进
        const nextTargetLine = targetLines[targetLineIndex + 1];
        const leadingSpaces = this.getLeadingSpaces(nextTargetLine);

        this.logger.info(`[DEBUG] Line ${targetLineIndex} content filled, need to insert newline`);
        this.logger.info(`[DEBUG] Insert newline + ${leadingSpaces.length} indent chars at offset ${originalOffset}`);

        return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
      }

      currentLineIndex++;
      targetLineIndex++;
    }

    // 检查 current 是否有多余的行
    if (currentLineIndex < currentLines.length) {
      const remainingLines = currentLines.slice(currentLineIndex);

      // 特殊情况：如果只剩一个空字符串，说明文档以换行符结尾
      // 这不应该被忽略，应该与 target 的尾部换行符情况对比
      if (remainingLines.length === 1 && remainingLines[0] === '') {
        // Current 有尾部换行符，检查 target 是否也有
        // target 有尾部换行符的条件：targetLines 的最后一个元素也是空字符串
        const targetHasTrailingNewline = targetLines.length > 0 && targetLines[targetLines.length - 1] === '';
        if (!targetHasTrailingNewline) {
          // Target 没有尾部换行符，但 current 有，这是不匹配
          const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
          const originalOffset = this.mapNormalizedToOriginal(lineStartOffset, currentMapping);
          this.logger.info(`[DEBUG] Current has trailing newline but target doesn't - mismatch`);
          return { state: 'mismatch', offset: originalOffset };
        }
        // 两者都有尾部换行符，忽略这个差异
        this.logger.info(`[DEBUG] Both have trailing newlines, treating as in sync`);
      } else {
        // 多余的行不是单个空字符串，检查是否有实质内容
        const remainingText = remainingLines.join('\n');
        if (!this.isWhitespaceOnly(remainingText)) {
          const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
          const originalOffset = this.mapNormalizedToOriginal(lineStartOffset, currentMapping);
          this.logger.info(`[DEBUG] Current has extra non-whitespace lines`);
          return { state: 'mismatch', offset: originalOffset };
        }
        this.logger.info(`[DEBUG] Current has trailing whitespace only, ignoring`);
      }
    }

    // 完全同步
    this.logger.info(`[DEBUG] Documents are in sync`);
    return { state: 'inSync' };
  }

  /**
   * 检测某行是否是结构性的行（如闭合括号、只有空白等）
   */
  private isStructuralLine(line: string): boolean {
    const trimmed = line.trim();
    // 空行或只有结构符号（}, {, ); 等）
    if (trimmed === '') {
      return true;
    }
    // 检查是否只包含结构符号
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (c !== '}' && c !== '{' && c !== ';' && c !== ',' && c !== ')' && c !== ']') {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取指定行在文档中的起始偏移量（规范化后的文本）
   */
  private getLineStartOffset(normalizedText: string, lineIndex: number): number {
    if (lineIndex === 0) {
      return 0;
    }

    let offset = 0;
    let currentLine = 0;

    for (let i = 0; i < normalizedText.length; i++) {
      if (normalizedText[i] === '\n') {
        currentLine++;
        if (currentLine === lineIndex) {
          return i + 1; // 换行符之后的位置
        }
      }
    }

    return normalizedText.length;
  }

  /**
   * 获取字符的可读描述（用于调试）
   */
  private getCharDescription(char: string): string {
    if (char === '\n') {
      return '\\n (newline)';
    }
    if (char === '\r') {
      return '\\r (carriage return)';
    }
    if (char === '\t') {
      return '\\t (tab)';
    }
    if (char === ' ') {
      return '<space>';
    }
    if (char.charCodeAt(0) < 32) {
      return `<0x${char.charCodeAt(0).toString(16)}>`;
    }
    return `'${char}'`;
  }

  private analyzeDocumentState(
    editor: vscode.TextEditor,
    current: string,
    target: string,
  ):
    | { state: 'inSync' }
    | { state: 'mismatch'; offset: number }
    | { state: 'gap'; insertOffset: number; nextChar: string; cursorBackOffset?: number; deleteCount?: number } {
    // 使用新的子序列匹配算法
    const result = this.computeNextGap(current, target);

    // 如果是 gap 状态，自动移动光标到插入位置
    if (result.state === 'gap' && !this.isCursorAt(editor, result.insertOffset)) {
      this.moveCursorTo(editor, result.insertOffset);
    }

    return result;
  }

  private isCursorAt(editor: vscode.TextEditor, offset: number): boolean {
    if (!editor.selection.isEmpty) {
      return false;
    }
    const cursorOffset = editor.document.offsetAt(editor.selection.start);
    return cursorOffset === offset;
  }

  private isAutoPairClosingChar(char: string): boolean {
    if (!char || char.length !== 1) {
      return false;
    }
    return ')]}\'"`'.includes(char);
  }

  /**
   * 将换行符转换为文档的 EOL 格式
   * 支持包含换行符的字符串（如 "\n    "）
   */
  private convertToDocumentEOL(editor: vscode.TextEditor, char: string): string {
    if (!char.includes('\n')) {
      return char;
    }

    // 获取文档的 EOL 设置
    const eol = editor.document.eol;
    if (eol === vscode.EndOfLine.CRLF) {
      // 将所有 \n 替换为 \r\n
      return char.replace(/\n/g, '\r\n');
    }
    return char;
  }

  private adjustCursorBackOffsetForEOL(
    originalText: string,
    convertedText: string,
    cursorBackOffset?: number,
  ): number | undefined {
    if (!cursorBackOffset || cursorBackOffset <= 0) {
      return cursorBackOffset;
    }

    if (originalText === convertedText) {
      return cursorBackOffset;
    }

    const clamped = Math.min(cursorBackOffset, originalText.length);
    const desiredIndex = Math.max(0, originalText.length - clamped);
    const beforeCursor = originalText.substring(0, desiredIndex);
    const newlineBeforeCursor = this.countNewlines(beforeCursor);
    const adjustedIndex = desiredIndex + newlineBeforeCursor;
    const adjustedCursorBack = Math.max(0, convertedText.length - adjustedIndex);
    return adjustedCursorBack;
  }

  private isEnterKeypress(typedText: string | undefined): boolean {
    if (!typedText) {
      return false;
    }
    return typedText.includes('\n') || typedText.includes('\r');
  }

  /**
   * 提取字符串开头的空白字符（空格和制表符）
   * 不使用正则表达式，确保性能和安全性
   */
  private getLeadingSpaces(line: string): string {
    let i = 0;
    while (i < line.length) {
      const char = line[i];
      if (char === ' ' || char === '\t') {
        i++;
      } else {
        break;
      }
    }
    return line.substring(0, i);
  }

  /**
   * 计算一行的有效内容长度（忽略首尾空白）
   */
  private getLineEffectiveLength(line: string): number {
    return line.trim().length;
  }

  /**
   * 比较两行是否"本质相同"，忽略尾部空白和单行注释差异
   * 用于向前查找时的灵活匹配
   */
  private linesEssentiallyMatch(line1: string, line2: string): boolean {
    // 去除尾部空白
    const trimmed1 = line1.trimEnd();
    const trimmed2 = line2.trimEnd();

    if (trimmed1 === trimmed2) {
      return true;
    }

    // 去除常见的单行注释后缀 (//... 或 #... 或 /*...*/)
    const withoutComment1 = this.stripTrailingComment(trimmed1);
    const withoutComment2 = this.stripTrailingComment(trimmed2);

    return withoutComment1 === withoutComment2;
  }

  private isPlaceholderDeletionLine(line: string): boolean {
    return line.includes('[DELETED]');
  }

  /**
   * 计算两个字符串的最长公共子序列(LCS)长度
   * 使用动态规划，空间优化版本（只保留两行）
   */
  private lcsLength(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;

    if (m === 0 || n === 0) {
      return 0;
    }

    // 空间优化：只需要两行的DP数组
    let prev = new Array(n + 1).fill(0);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          curr[j] = prev[j - 1] + 1;
        } else {
          curr[j] = Math.max(prev[j], curr[j - 1]);
        }
      }
      // 交换prev和curr
      [prev, curr] = [curr, prev];
    }

    return prev[n];
  }

  /**
   * 检测是否删除了代码块（如if{}, for{}, while{}等）
   * 场景：目标文件有完整的代码块，当前文件删除了块内容
   *
   * 例如：
   * Target:  if (x) {        Current:  if (x) {
   *              stmt1                     }
   *              stmt2
   *          }
   *
   * @returns true 如果检测到代码块被删除
   */
  private detectBlockDeletion(
    currentLineIndex: number,
    targetLineIndex: number,
    currentLines: string[],
    targetLines: string[]
  ): boolean {
    const currentLine = currentLines[currentLineIndex] || '';
    const targetLine = targetLines[targetLineIndex];

    // 如果当前行本身是空白，说明我们只是在填充缩进或新行，不应该触发块删除逻辑
    if (currentLine.trim().length === 0) {
      this.logger.info('[DEBUG] Current line is whitespace only; skip block-deletion detection');
      return false;
    }

    // 如果当前行的有效内容长度不到目标行的一半，说明尚在逐字符填充，不触发块删除逻辑
    const currentEffectiveLen = this.getLineEffectiveLength(currentLine);
    const targetEffectiveLen = this.getLineEffectiveLength(targetLine);
    if (targetEffectiveLen > 0 && currentEffectiveLen < targetEffectiveLen * 0.5) {
      this.logger.info('[DEBUG] Current line content still under half of target; skip block-deletion detection');
      return false;
    }

    // 条件1: 当前行和目标行的相似度很低（可能完全不同）
    // 条件2: 检查目标文件是否有多行内容，而当前文件缺少这些行
    // 通过"向前查找"检测：当前行是否匹配目标文件后面的某行
    const maxLookAhead = 30; // 查找范围增加到30行，覆盖更多场景

    this.logger.info(`[DEBUG] detectBlockDeletion: checking if current[${currentLineIndex}]="${currentLine.trim()}" matches later target lines`);

    for (let futureTargetIdx = targetLineIndex + 1;
         futureTargetIdx < Math.min(targetLineIndex + maxLookAhead + 1, targetLines.length);
         futureTargetIdx++) {

      // 如果当前行匹配目标文件后面的某一行
      if (currentLine === targetLines[futureTargetIdx] ||
          this.linesEssentiallyMatch(currentLine, targetLines[futureTargetIdx])) {

        const missingLineCount = futureTargetIdx - targetLineIndex;
        this.logger.info(`[DEBUG] MATCH found at Target[${futureTargetIdx}]! Missing ${missingLineCount} lines`);

        const missingLines = targetLines.slice(targetLineIndex, futureTargetIdx);

        // 条件3: 检查缺失的这些行是否构成一个代码块
        // 方法1: 检查缺失的行本身是否有块模式
        let hasBlockPattern = this.hasCodeBlockPattern(missingLines);

        // 方法2: 如果缺失行本身没有块模式，检查前一行（已匹配的行）是否是块开始
        // 这处理了块内容被删除但块开始行已经匹配的情况
        if (!hasBlockPattern && targetLineIndex > 0) {
          const previousTargetLine = targetLines[targetLineIndex - 1];
          this.logger.info(`[DEBUG] Checking if previous line is block start: "${previousTargetLine.trim()}"`);

          // 将前一行和缺失行一起检查
          const linesWithPrevious = [previousTargetLine, ...missingLines];
          hasBlockPattern = this.hasCodeBlockPattern(linesWithPrevious);
          this.logger.info(`[DEBUG] hasCodeBlockPattern (with previous line): ${hasBlockPattern}`);
        }

        if (hasBlockPattern && missingLineCount >= 2) {
          this.logger.info(`[DEBUG] Block deletion detected: ${missingLineCount} lines missing`);
          this.logger.info(`[DEBUG] Current line matches Target[${futureTargetIdx}], indicating Target[${targetLineIndex}-${futureTargetIdx - 1}] are missing`);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 检查一组行是否包含代码块模式
   * 识别常见的代码块结构（不使用正则表达式）
   */
  private hasCodeBlockPattern(lines: string[]): boolean {
    if (lines.length === 0) {
      return false;
    }

    const firstLine = lines[0];
    const firstLineTrimmed = firstLine.trimEnd();

    // 模式1: 行以 { 结尾（C-like 代码块开始）
    const hasBraceBlock = firstLineTrimmed.endsWith('{');

    // 模式2: 行以 : 结尾（Python 代码块开始）
    const hasColonBlock = firstLineTrimmed.endsWith(':');

    // 模式3: 行以 > 结尾且包含 <（可能是 HTML 标签）
    const hasTagBlock = firstLineTrimmed.endsWith('>') && firstLineTrimmed.includes('<');

    // 模式4: 检查是否有明显的缩进增加（块的特征）
    const firstIndent = this.getLeadingSpaces(lines[0]).length;
    let hasIndentIncrease = false;
    for (let i = 1; i < lines.length; i++) {
      const lineIndent = this.getLeadingSpaces(lines[i]).length;
      if (lineIndent > firstIndent) {
        hasIndentIncrease = true;
        break;
      }
    }

    return hasBraceBlock || hasColonBlock || hasTagBlock || hasIndentIncrease;
  }

  /**
   * 基于LCS计算两行的相似度
   * 返回值在0-1之间，1表示完全相同
   * 这个方法对小的插入/删除更鲁棒
   */
  private calculateLineSimilarity(line1: string, line2: string): number {
    if (line1 === line2) {
      return 1.0;
    }

    const len1 = line1.length;
    const len2 = line2.length;

    if (len1 === 0 && len2 === 0) {
      return 1.0;
    }

    if (len1 === 0 || len2 === 0) {
      return 0.0;
    }

    const lcs = this.lcsLength(line1, line2);
    const longerLen = Math.max(len1, len2);

    // 相似度 = LCS长度 / 较长字符串的长度
    return lcs / longerLen;
  }

  private getAutoPairInsertion(input: string): { text: string; cursorBackOffset: number } | undefined {
    if (input.length !== 1) {
      return undefined;
    }

    const char = input[0];
    switch (char) {
      case '{':
        return { text: '{}', cursorBackOffset: 1 };
      case '(':
        return { text: '()', cursorBackOffset: 1 };
      case '[':
        return { text: '[]', cursorBackOffset: 1 };
      default:
        return undefined;
    }
  }

  /**
   * 从 target 内容中获取指定换行符位置之后下一行的前导缩进
   * @param targetContent target 文件的完整内容（已规范化为 LF）
   * @param newlineOffset 换行符 \n 的偏移量
   * @returns 下一行的前导空格字符串，如果没有下一行则返回空字符串
   */
  private getNextLineIndentFromOffset(targetContent: string, newlineOffset: number): string {
    // newlineOffset 指向 \n，下一行从 newlineOffset + 1 开始
    const nextLineStart = newlineOffset + 1;

    // 边界检查：如果没有下一行内容
    if (nextLineStart >= targetContent.length) {
      return '';
    }

    // 收集下一行的前导空格和制表符（不使用正则）
    let indent = '';
    for (let i = nextLineStart; i < targetContent.length; i++) {
      const char = targetContent[i];
      if (char === ' ' || char === '\t') {
        indent += char;
      } else {
        // 遇到非空白字符，停止
        break;
      }
    }

    return indent;
  }

  /**
   * 检测是否需要智能展开 `{` 为代码块
   * 条件：target 文件中 `{` 紧跟换行符
   * @param editor 当前编辑器
   * @param targetContent target 文件的规范化内容
   * @param offset 当前插入位置（在规范化 target 中）
   * @returns 展开后的文本或 undefined（不展开）
   */
  private detectSmartBraceExpansion(
    editor: vscode.TextEditor,
    targetContent: string,
    offset: number
  ): string | undefined {
    // 边界检查：确保 offset 和 offset+1 在范围内
    if (offset < 0 || offset >= targetContent.length) {
      return undefined;
    }

    // 检查 target 在此位置是否是 `{`
    if (targetContent[offset] !== '{') {
      return undefined;
    }

    // 检查 `{` 后面是否紧跟换行符
    if (offset + 1 >= targetContent.length || targetContent[offset + 1] !== '\n') {
      return undefined;
    }

    // 触发智能展开：获取下一行的缩进
    const nextLineIndent = this.getNextLineIndentFromOffset(targetContent, offset + 1);

    this.logger.info(`[SMART BLOCK] Detected '{' followed by newline in target at offset ${offset}`);
    this.logger.info(`[SMART BLOCK] Next line indent: ${nextLineIndent.length} chars`);

    // 构建展开文本: {\n + 缩进 + }
    // 使用 \n 构建，然后通过 convertToDocumentEOL 转换为文档的 EOL 格式
    const rawExpansion = '{\n' + nextLineIndent + '}';
    const expandedText = this.convertToDocumentEOL(editor, rawExpansion);

    this.logger.info(`[SMART BLOCK] Expanded to: "${this.getContentPreview(expandedText, 50)}"`);

    return expandedText;
  }

  private findBraceAfterParenthesis(
    text: string,
    startIndex: number,
  ): { braceIndex: number; betweenText: string } | undefined {
    let i = startIndex;
    let between = '';
    while (i < text.length) {
      const char = text[i];
      if (char === '{') {
        return { braceIndex: i, betweenText: between };
      }
      if (char === '=') {
        if (text[i + 1] === '>') {
          between += '=>';
          i += 2;
          continue;
        }
        return undefined;
      }
      if (char === '\n' || char === '\t' || char === ' ') {
        between += char;
        i++;
        continue;
      }
      if (this.isAllowedBetweenChar(char)) {
        between += char;
        i++;
        continue;
      }
      return undefined;
    }
    return undefined;
  }

  private getWordBefore(line: string, endIndex: number): string {
    const prefix = line.substring(0, endIndex);
    // 从末尾向前跳过空白
    let i = prefix.length - 1;
    while (i >= 0 && (prefix[i] === ' ' || prefix[i] === '\t')) {
      i--;
    }
    if (i < 0) {
      return '';
    }
    // 从当前位置向前收集标识符字符
    let wordEnd = i + 1;
    while (i >= 0 && this.isIdentifierChar(prefix[i])) {
      i--;
    }
    const wordStart = i + 1;
    if (wordStart >= wordEnd) {
      return '';
    }
    const word = prefix.substring(wordStart, wordEnd);
    // 确保首字符是字母或下划线
    if (word.length > 0 && this.isIdentifierStartChar(word[0])) {
      return word;
    }
    return '';
  }

  private isLikelyOpeningQuote(line: string, charIndex: number, quote: string): boolean {
    let escape = false;
    let count = 0;
    for (let i = 0; i < charIndex; i++) {
      const char = line[i];
      if (char === '\\' && !escape) {
        escape = true;
        continue;
      }
      if (char === quote && !escape) {
        count++;
      }
      escape = false;
    }
    return count % 2 === 0;
  }

  /**
   * 计算字符串中换行符的数量
   * 不使用正则表达式
   */
  private countNewlines(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        count++;
      }
    }
    return count;
  }

  /**
   * 检查字符是否是允许出现在括号之间的字符
   * 不使用正则表达式
   */
  private isAllowedBetweenChar(char: string): boolean {
    const allowed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_<>[]?!:.,|&';
    return allowed.includes(char);
  }

  /**
   * 检查字符是否是标识符字符（字母、数字、下划线）
   */
  private isIdentifierChar(char: string): boolean {
    const code = char.charCodeAt(0);
    // A-Z: 65-90, a-z: 97-122, 0-9: 48-57, _: 95
    return (code >= 65 && code <= 90) ||
           (code >= 97 && code <= 122) ||
           (code >= 48 && code <= 57) ||
           code === 95;
  }

  /**
   * 检查字符是否是标识符起始字符（字母、下划线）
   */
  private isIdentifierStartChar(char: string): boolean {
    const code = char.charCodeAt(0);
    // A-Z: 65-90, a-z: 97-122, _: 95
    return (code >= 65 && code <= 90) ||
           (code >= 97 && code <= 122) ||
           code === 95;
  }

  /**
   * 检查字符串是否只包含空白字符（空格、制表符、换行符）
   * 不使用正则表达式
   */
  private isWhitespaceOnly(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
        return false;
      }
    }
    return true;
  }

  /**
   * 检查字符串是否是配对符骨架（如 "()", "{}", "[]", "(", "{", "["）
   * 不使用正则表达式
   */
  private isPairSkeletonString(str: string): boolean {
    if (str.length === 0 || str.length > 2) {
      return false;
    }
    const openChars = '([{';
    const closeChars = ')]}';

    if (str.length === 1) {
      // 单个开括号
      return openChars.includes(str[0]);
    }

    // 长度为 2：必须是开括号+对应闭括号
    const openIdx = openChars.indexOf(str[0]);
    if (openIdx === -1) {
      return false;
    }
    // 闭括号可以是对应的，也可以省略
    return str[1] === closeChars[openIdx] || closeChars.includes(str[1]);
  }

  /**
   * 去除字符串末尾的注释（// 或 # 或 /*）
   * 不使用正则表达式
   */
  private stripTrailingComment(line: string): string {
    // 查找 // 注释
    const slashSlashIdx = line.indexOf('//');
    // 查找 # 注释
    const hashIdx = line.indexOf('#');
    // 查找 /* 注释
    const slashStarIdx = line.indexOf('/*');

    let cutIdx = line.length;

    if (slashSlashIdx !== -1 && slashSlashIdx < cutIdx) {
      cutIdx = slashSlashIdx;
    }
    if (hashIdx !== -1 && hashIdx < cutIdx) {
      cutIdx = hashIdx;
    }
    if (slashStarIdx !== -1 && slashStarIdx < cutIdx) {
      cutIdx = slashStarIdx;
    }

    if (cutIdx === line.length) {
      return line;
    }

    // 去除注释前的尾部空白
    let result = line.substring(0, cutIdx);
    while (result.length > 0 && (result[result.length - 1] === ' ' || result[result.length - 1] === '\t')) {
      result = result.substring(0, result.length - 1);
    }
    return result;
  }
}
