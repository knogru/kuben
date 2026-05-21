import * as vscode from 'vscode';
import { ASTManager } from './astManager';

export class ContextManager {
  constructor(private astManager: ASTManager) {}

  // Build a surgical FIM prefix and suffix for the current document/position.
  async buildPrefixSuffix(document: vscode.TextDocument, position: vscode.Position, contextWindow: number) {
    // gather local context lines
    const lineNumber = position.line;
    const charPos = position.character;
    const startLine = Math.max(0, lineNumber - contextWindow);
    const prefixLocal = document.getText(new vscode.Range(startLine, 0, lineNumber, charPos));
    const endLine = Math.min(document.lineCount - 1, lineNumber + 5);
    const suffixLocal = document.getText(new vscode.Range(lineNumber, charPos, endLine, 0));

    // gather nearby symbol signatures from ASTManager
    const symbols = await this.astManager.getSymbolsNear(document, position);
    const deps: string[] = [];
    for (const s of symbols) {
      // include only symbols defined above the cursor for now
      if (s.range.end.line <= lineNumber) {
        deps.push(`${s.name} @ L${s.range.start.line + 1}`);
      }
    }

    // create language-appropriate comment block (JS/TS uses //)
    const metaComment = deps.length ? `// [DEP]: ${deps.join(', ')}\n` : '';

    const prefix = `${metaComment}${prefixLocal}`;
    const suffix = suffixLocal;

    return { prefix, suffix };
  }
}

export default ContextManager;
