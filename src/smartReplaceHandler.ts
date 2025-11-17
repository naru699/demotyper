import * as vscode from 'vscode';
import { TargetFileManager } from './targetFileManager';
import { Logger } from './logger';
import { SmartReplaceResult, UndoFriendlyEditOptions } from './types';
import { NotificationManager } from './notificationManager';

export class SmartReplaceHandler {
  private documentSnapshot?: { version: number; text: string };

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

    const { insertOffset, nextChar } = analysis;

    const editOptions = editOptionsFactory();

    // 将要插入的字符转换为文档的 EOL 格式
    const textToInsert = this.convertToDocumentEOL(editor, nextChar);

    const inserted = await this.insertAt(editor, insertOffset, textToInsert, editOptions);
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
  }

  private async insertAt(
    editor: vscode.TextEditor,
    offset: number,
    text: string,
    editOptions: UndoFriendlyEditOptions,
  ): Promise<boolean> {
    const position = editor.document.positionAt(offset);
    const charDesc = this.getCharDescription(text);

    this.logger.info(`[INSERT] At offset ${offset} (line ${position.line}, char ${position.character}), inserting: ${charDesc}, length: ${text.length}`);
    this.logger.info(`[INSERT] Document EOL: ${editor.document.eol === vscode.EndOfLine.CRLF ? 'CRLF' : 'LF'}`);

    // 记录插入前文档内容的片段
    const beforeText = editor.document.getText();
    const beforePreview = this.getContentPreview(beforeText.substring(Math.max(0, offset - 10), offset + 20), 50);
    this.logger.info(`[INSERT] Before insert, around offset: "${beforePreview}"`);

    const applied = await editor.edit(
      (editBuilder) => {
        editBuilder.insert(position, text);
      },
      editOptions,
    );

    if (!applied) {
      this.logger.info(`[INSERT] Failed to apply edit`);
      return false;
    }

    // 记录插入后文档内容的片段
    const afterText = editor.document.getText();
    const afterPreview = this.getContentPreview(afterText.substring(Math.max(0, offset - 10), offset + 30), 60);
    this.logger.info(`[INSERT] After insert, around offset: "${afterPreview}"`);

    // 在插入后，基于实际的文档内容计算新的光标位置
    let nextPosition: vscode.Position;

    // 特殊处理包含换行符的文本：需要正确计算光标在哪一行哪一列
    if (text.includes('\n')) {
      // 获取插入位置
      const insertPosition = editor.document.positionAt(offset);

      // 计算插入的文本中有多少个换行符
      const lines = text.split('\n');
      const newlineCount = lines.length - 1;

      // 新行号 = 插入位置的行号 + 换行符数量
      const newLineNumber = insertPosition.line + newlineCount;

      // 光标应该在最后一行内容的末尾
      // 例如: 插入 "\n    " 应该让光标在新行的第4列（4个空格后）
      const lastLineContent = lines[lines.length - 1];
      const newCharacter = lastLineContent.length;

      this.logger.info(`[INSERT] Inserted text with ${newlineCount} newline(s), cursor will be at line ${newLineNumber}, char ${newCharacter}`);
      nextPosition = new vscode.Position(newLineNumber, newCharacter);
    } else {
      // 其他字符：光标在插入文本之后
      const actualInsertedLength = this.calculateInsertedLength(text, editor.document.eol);
      const newOffset = offset + actualInsertedLength;
      nextPosition = editor.document.positionAt(newOffset);
      this.logger.info(`[INSERT] Text length: ${text.length}, actual inserted: ${actualInsertedLength}, new offset: ${newOffset}`);
    }

    editor.selection = new vscode.Selection(nextPosition, nextPosition);

    this.logger.info(`[INSERT] Success, cursor at line ${nextPosition.line}, char ${nextPosition.character}`);
    this.logger.info(`[INSERT] Document length changed from ${beforeText.length} to ${afterText.length}`);
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
    | { state: 'gap'; insertOffset: number; nextChar: string }
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

        this.logger.info(`[DEBUG] Need to append line ${targetLineIndex}: "${targetLine}"`);
        this.logger.info(`[DEBUG] Insert newline at offset ${originalOffset}`);

        return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' };
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
              // 下一行不匹配，向前查找：nextCurrentLine 是否匹配 target 的后续行
              // 增加查找范围到10行，并使用灵活匹配（忽略尾部空白和注释）
              let foundInLaterTarget = false;
              let matchedTargetIndex = -1;
              const maxLookAhead = 10;

              for (let i = targetLineIndex + 2; i < Math.min(targetLineIndex + 2 + maxLookAhead, targetLines.length); i++) {
                // 先尝试严格匹配，再尝试灵活匹配
                if (currentLines[currentLineIndex + 1] === targetLines[i] ||
                    this.linesEssentiallyMatch(currentLines[currentLineIndex + 1], targetLines[i])) {
                  foundInLaterTarget = true;
                  matchedTargetIndex = i;
                  this.logger.info(`[DEBUG] Current[${currentLineIndex + 1}] matches Target[${i}] (distance: ${i - (targetLineIndex + 1)}), indicating Target[${targetLineIndex + 1}] is missing`);
                  break;
                }
              }

              if (foundInLaterTarget) {
                // Current的下一行匹配Target的更后面的行，说明中间缺行
                const originalOffset = this.mapNormalizedToOriginal(lineEndOffset, currentMapping);

                // 获取目标文件下一行的前导空格（缩进）
                const nextTargetLine = targetLines[targetLineIndex + 1];
                const leadingSpaces = this.getLeadingSpaces(nextTargetLine);

                this.logger.info(`[DEBUG] Line ${targetLineIndex} matches, but next line mismatch indicates missing line`);
                this.logger.info(`[DEBUG] Insert newline + ${leadingSpaces.length} spaces at offset ${originalOffset} to add missing line`);
                return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
              } else {
                // 没有在附近找到匹配，可能是大范围的行变化
                // 不做处理，继续到下一轮逐字符比对
                this.logger.info(`[DEBUG] Next line mismatch, but no nearby match found (checked ${maxLookAhead} lines ahead)`);
                this.logger.info(`[DEBUG] Will continue with character-by-character comparison`);
              }
            }
          } else {
            // Current没有下一行，但Target有，需要追加
            const originalOffset = this.mapNormalizedToOriginal(lineEndOffset, currentMapping);

            // 获取目标文件下一行的前导空格（缩进）
            const nextTargetLine = targetLines[targetLineIndex + 1];
            const leadingSpaces = this.getLeadingSpaces(nextTargetLine);

            this.logger.info(`[DEBUG] Line ${targetLineIndex} matches, but need to append more lines`);
            this.logger.info(`[DEBUG] Insert newline + ${leadingSpaces.length} spaces at offset ${originalOffset}`);
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
        this.logger.info(`[DEBUG] Will insert missing lines starting from target line ${targetLineIndex}`);

        // 在当前行之前插入目标行
        const currentLineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
        const originalOffset = this.mapNormalizedToOriginal(currentLineStartOffset, currentMapping);
        const leadingSpaces = this.getLeadingSpaces(targetLine);

        return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
      }

      // 检测是否需要插入新行（行数不匹配的情况）
      const isCurrentEmpty = currentLine.trim() === '';
      const isTargetEmpty = targetLine.trim() === '';

      // 情况1: 当前是空行，目标不是空行
      if (isCurrentEmpty && !isTargetEmpty) {
        // 检查当前行是否只有缩进（支持空格和制表符混合）
        const currentIndent = currentLine.match(/^[ \t]*/)?.[0] || '';
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
        // 只有当前行长度达到目标行长度的50%以上时，才做相似度检测
        // 否则可能是正在填充中的行，应该继续填充
        const currentTrimmedLen = currentLine.trim().length;
        const targetTrimmedLen = targetLine.trim().length;

        if (currentTrimmedLen < targetTrimmedLen * 0.5) {
          // 当前行太短，可能还在填充中，继续往下执行逐字符比对
          this.logger.info(`[DEBUG] Current line is still short (${currentTrimmedLen} < ${targetTrimmedLen * 0.5}), continue filling`);
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
          // 增加查找范围到10行，并使用灵活匹配
          if (similarity >= 0.5 && targetLineIndex + 1 < targetLines.length) {
            const maxLookAhead = 10;
            // 检查当前行是否匹配目标的后续某一行（查找附近10行，支持灵活匹配）
            for (
              let futureTargetIdx = targetLineIndex + 1;
              futureTargetIdx < Math.min(targetLineIndex + 1 + maxLookAhead, targetLines.length);
              futureTargetIdx++
            ) {
              if (currentLine === targetLines[futureTargetIdx] ||
                  this.linesEssentiallyMatch(currentLine, targetLines[futureTargetIdx])) {
                // 当前行匹配目标的后续行，说明目标的当前行在current中缺失
                const currentLineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);
                const originalOffset = this.mapNormalizedToOriginal(currentLineStartOffset, currentMapping);

                // 获取目标文件当前行的前导空格（缩进）
                const leadingSpaces = this.getLeadingSpaces(targetLine);

                this.logger.info(`[DEBUG] Forward lookup: Current[${currentLineIndex}] matches Target[${futureTargetIdx}] (distance: ${futureTargetIdx - targetLineIndex})`);
                this.logger.info(`[DEBUG] This means Target[${targetLineIndex}] is missing in current`);
                this.logger.info(`[DEBUG] Insert newline + ${leadingSpaces.length} indent chars before current line at offset ${originalOffset}`);

                return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' + leadingSpaces };
              }
            }
          }
        }
      }

      // 计算这一行在文档中的起始偏移量
      const lineStartOffset = this.getLineStartOffset(normalizedCurrent, currentLineIndex);

      // 逐字符比对找出差异
      const maxLen = Math.max(currentLine.length, targetLine.length);
      for (let charIdx = 0; charIdx < maxLen; charIdx++) {
        const currentChar = currentLine[charIdx];
        const targetChar = targetLine[charIdx];

        if (currentChar !== targetChar) {
          const charOffset = lineStartOffset + charIdx;
          const originalOffset = this.mapNormalizedToOriginal(charOffset, currentMapping);

          // 如果目标字符不存在（目标行已结束），但当前字符存在，说明当前行比目标行长
          if (targetChar === undefined && currentChar !== undefined) {
            // 检查是否已经完全匹配了目标行的全部内容
            if (charIdx === targetLine.length && targetLineIndex < targetLines.length - 1) {
              // 已经完全匹配目标行，且目标文件后面还有更多行
              // 说明当前行多出的内容应该在下一行，需要插入换行符
              this.logger.info(`[DEBUG] Current line has extra content after matching target line completely`);
              this.logger.info(`[DEBUG] Extra content: "${currentLine.substring(charIdx)}"`);
              this.logger.info(`[DEBUG] Insert newline at offset ${originalOffset}`);
              return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' };
            }

            // 否则是真正的不同步情况
            this.logger.info(`[DEBUG] Current line is longer than target line at pos ${charIdx} (mismatch)`);
            this.logger.info(`[DEBUG] Current has extra content: "${currentLine.substring(charIdx)}"`);
            return { state: 'mismatch', offset: originalOffset };
          }

          let nextChar = targetChar || '';

          // 直接返回需要插入的字符，不做特殊处理

          const charDesc = this.getCharDescription(nextChar);

          this.logger.info(`[DEBUG] Char diff at line ${targetLineIndex}, pos ${charIdx}: insert ${charDesc}`);
          this.logger.info(`[DEBUG] Insert at offset ${originalOffset}`);

          return { state: 'gap', insertOffset: originalOffset, nextChar };
        }
      }

      // 如果到这里，说明逐字符比对后所有字符都匹配了
      // 但需要检查是否需要在行末插入换行符
      if (targetLineIndex < targetLines.length - 1) {
        // 目标文件中该行后面还有更多行，需要插入换行符
        const lineEndOffset = lineStartOffset + targetLine.length;
        const originalOffset = this.mapNormalizedToOriginal(lineEndOffset, currentMapping);

        this.logger.info(`[DEBUG] Line ${targetLineIndex} content filled, need to insert newline`);
        this.logger.info(`[DEBUG] Insert newline at offset ${originalOffset}`);

        return { state: 'gap', insertOffset: originalOffset, nextChar: '\n' };
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
        if (!/^\s*$/.test(remainingText)) {
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
    return trimmed === '' || /^[\}\{;,\)\]]+$/.test(trimmed);
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
    | { state: 'gap'; insertOffset: number; nextChar: string } {
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

  private isEnterKeypress(typedText: string | undefined): boolean {
    if (!typedText) {
      return false;
    }
    return typedText.includes('\n') || typedText.includes('\r');
  }

  /**
   * 提取字符串开头的空白字符（空格和制表符）
   */
  private getLeadingSpaces(line: string): string {
    const match = line.match(/^[ \t]*/);
    return match ? match[0] : '';
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
    const withoutComment1 = trimmed1.replace(/\s*(\/\/|#|\/\*).*$/, '').trimEnd();
    const withoutComment2 = trimmed2.replace(/\s*(\/\/|#|\/\*).*$/, '').trimEnd();

    return withoutComment1 === withoutComment2;
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
    // 条件1: 当前行和目标行的相似度很低（可能完全不同）
    const currentLine = currentLines[currentLineIndex] || '';
    const targetLine = targetLines[targetLineIndex];

    // 条件2: 检查目标文件是否有多行内容，而当前文件缺少这些行
    // 通过"向前查找"检测：当前行是否匹配目标文件后面的某行
    const maxLookAhead = 15; // 查找范围增加到15行，覆盖更多场景

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
   * 识别常见的代码块结构：
   * - 大括号块：{ ... }
   * - Python冒号块：if/for/while/def/class ... :
   * - HTML标签块：<tag> ... </tag>
   */
  private hasCodeBlockPattern(lines: string[]): boolean {
    if (lines.length === 0) {
      return false;
    }

    const allText = lines.join(' ').trim();

    // 模式1: C-like大括号块 (if{}, for{}, while{}, function{} 等)
    const hasBraceBlock = /\b(if|for|while|function|class|def|struct)\s*\([^)]*\)\s*\{|\{\s*$/.test(lines[0]);

    // 模式2: Python冒号块
    const hasColonBlock = /\b(if|for|while|def|class|with|try|except|finally|elif|else)\b.*:\s*$/.test(lines[0]);

    // 模式3: HTML/XML标签块
    const hasTagBlock = /<\w+[^>]*>.*<\/\w+>/.test(allText) || /<\w+[^>]*>\s*$/.test(lines[0]);

    // 模式4: 检查是否有明显的缩进增加（块的特征）
    const firstIndent = this.getLeadingSpaces(lines[0]).length;
    const hasIndentIncrease = lines.slice(1).some(line => {
      const lineIndent = this.getLeadingSpaces(line).length;
      return lineIndent > firstIndent;
    });

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
}
