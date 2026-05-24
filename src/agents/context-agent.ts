import * as vscode from 'vscode';
import { ISyntaxBounds } from '../domain/types';
import { ASTManager } from '../astManager';
import { SymbolLocation } from '../symbolIndexer';

export class ContextAgent {
    private astManager: ASTManager;

    constructor(astManager: ASTManager) {
        this.astManager = astManager;
    }

    async getSyntaxBounds(document: vscode.TextDocument, position: vscode.Position): Promise<ISyntaxBounds> {
        const symbols = await this.astManager.getSymbolsNear(document, position);
        const braceStack = this.computeBraceStack(document, position);

        let isInsideFunction = false;
        let isInsideClass = false;
        let isInsideBlock = false;
        let blockType: string = 'source_file';
        let startLine = 0;
        let endLine = document.lineCount - 1;

        for (const sym of symbols) {
            if (sym.range.contains(position)) {
                if (sym.name.startsWith('function') || sym.name.startsWith('method')) {
                    isInsideFunction = true;
                    blockType = 'function_declaration';
                    startLine = sym.range.start.line;
                    endLine = sym.range.end.line;
                } else if (sym.name.startsWith('class')) {
                    isInsideClass = true;
                    if (!blockType || blockType === 'source_file') {
                        blockType = 'class_declaration';
                    }
                    startLine = sym.range.start.line;
                    endLine = sym.range.end.line;
                }
            }
        }

        const textLine = document.lineAt(position.line).text.trim();
        if (!isInsideFunction && !isInsideClass) {
            if (textLine.startsWith('import ') || textLine.startsWith('const ') || textLine.startsWith('let ') || textLine.startsWith('var ')) {
                blockType = 'import_declaration';
            }
        }

        isInsideBlock = braceStack.length > 0;

        return {
            blockType,
            hasValidScope: true,
            startLine,
            endLine,
            isInsideFunction,
            isInsideClass,
            isInsideBlock,
            braceStack,
        };
    }

    private computeBraceStack(document: vscode.TextDocument, position: vscode.Position): string[] {
        const stack: string[] = [];
        const map: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

        for (let line = 0; line <= position.line; line++) {
            const text = document.lineAt(line).text;
            const endChar = line === position.line ? position.character : text.length;
            for (let col = 0; col < endChar; col++) {
                const ch = text[col];
                if (map[ch]) {
                    stack.push(ch);
                } else if (ch === '}' || ch === ']' || ch === ')') {
                    const expected = Object.keys(map).find(k => map[k] === ch);
                    if (expected && stack.length > 0 && stack[stack.length - 1] === expected) {
                        stack.pop();
                    }
                }
            }
        }

        return stack;
    }
}

export default ContextAgent;
