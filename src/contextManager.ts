import * as vscode from 'vscode';
import { SymbolIndexer } from './symbolIndexer';
import { ASTManager } from './astManager';

export interface FimInferenceOptions {
    num_predict?: number;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
}

export interface FimPromptContext {
    prompt: string;
    suffix: string;
    options?: FimInferenceOptions;
}

export class ContextManager {
    private static instance: ContextManager | null = null;
    private symbolIndexer: SymbolIndexer;
    private astManager: ASTManager;

    public static getInstance(symbolIndexer?: SymbolIndexer, astManager?: ASTManager): ContextManager {
        if (!ContextManager.instance) {
            ContextManager.instance = new ContextManager(
                symbolIndexer ?? new SymbolIndexer(),
                astManager ?? ASTManager.getInstance()
            );
        }
        return ContextManager.instance;
    }

    constructor(symbolIndexer: SymbolIndexer, astManager: ASTManager) {
        this.symbolIndexer = symbolIndexer;
        this.astManager = astManager;
    }

    /**
     * Monta o prompt Fill-in-the-Middle (FIM) injetando metadados determinísticos
     * mantendo a latência abaixo do budget de 300ms.
     */
    public async buildFimPrompt(document: vscode.TextDocument, position: vscode.Position): Promise<FimPromptContext> {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const prefix = text.substring(0, offset);
        const suffix = text.substring(offset);

        const enableGraphRag = vscode.workspace.getConfiguration('kuben').get<boolean>('enableGraphRag', true);
        let metadataHeader = '';
        const commentPrefix = this.getCommentSign(document.languageId);
        let options: FimInferenceOptions | undefined;

        const tree = await this.astManager.parseDocument(document);
        const node = this.astManager.getNodeAtPosition(tree, position);

        if (enableGraphRag) {
            const contextLines = this.buildContextFromAst(document, position, tree);
            if (contextLines.length > 0) {
                metadataHeader += contextLines.map(line => `${commentPrefix} ${line}`).join('\n') + '\n';
            }

            const importLines = this.extractImports(tree);
            if (importLines.length > 0) {
                metadataHeader += importLines.map(line => `${commentPrefix} ${line}`).join('\n') + '\n';
            }
        }

        options = this.buildInferenceOptions(node, document, position);

        return {
            prompt: metadataHeader + prefix,
            suffix: suffix,
            options
        };
    }

    public async buildPrefixSuffix(document: vscode.TextDocument, position: vscode.Position, dependencies: any): Promise<FimPromptContext> {
        return this.buildFimPrompt(document, position);
    }

    private buildContextFromAst(document: vscode.TextDocument, position: vscode.Position, tree: any): string[] {
        const contextLines: string[] = [];

        if (!tree || tree.isFallback) {
            const symbols = this.symbolIndexer.getSymbolsForDocument(document.uri);
            symbols
                .filter(symbol => symbol.lineStart < position.line)
                .slice(-3)
                .forEach(symbol => {
                    contextLines.push(`[DEP]: ${symbol.name} encontrada na linha ${symbol.lineStart}`);
                });
            return contextLines;
        }

        const node = this.astManager.getNodeAtPosition(tree, position);
        if (!node) {
            return contextLines;
        }

        const relevantNodes = this.extractRelevantNodes(node);
        relevantNodes.forEach(item => contextLines.push(item));
        return contextLines;
    }

    private buildInferenceOptions(node: any, document: vscode.TextDocument, position: vscode.Position): FimInferenceOptions {
        const defaults: FimInferenceOptions = {
            num_predict: 64,
            temperature: 0.2,
            top_p: 0.95
        };

        if (!node) {
            return defaults;
        }

        const shortCompletionTypes = [
            'identifier',
            'property_identifier',
            'member_expression',
            'call_expression',
            'dot_member_expression'
        ];

        const mediumCompletionTypes = [
            'return_statement',
            'assignment_expression',
            'variable_declarator',
            'arguments',
            'arrow_function'
        ];

        const longCompletionTypes = [
            'function_declaration',
            'method_definition',
            'class_declaration',
            'program'
        ];

        if (shortCompletionTypes.includes(node.type)) {
            return {
                ...defaults,
                num_predict: 24,
                temperature: 0.15,
                max_tokens: 24
            };
        }

        if (mediumCompletionTypes.includes(node.type)) {
            return {
                ...defaults,
                num_predict: 32,
                temperature: 0.18,
                max_tokens: 48
            };
        }

        if (longCompletionTypes.includes(node.type)) {
            return {
                ...defaults,
                num_predict: 96,
                temperature: 0.22,
                max_tokens: 128
            };
        }

        return defaults;
    }

    private extractRelevantNodes(node: any): string[] {
        const lines: string[] = [];
        const functionNode = node.closest?.('function_declaration') || node.closest?.('method_definition');
        const classNode = node.closest?.('class_declaration');

        if (functionNode) {
            lines.push(`function: ${this.trimText(functionNode.text, 120)}`);
        }
        if (classNode) {
            lines.push(`class: ${this.trimText(classNode.text, 120)}`);
        }

        return lines.slice(0, 3);
    }

    private extractImports(tree: any): string[] {
        if (!tree || tree.isFallback) {
            return [];
        }

        const imports: string[] = [];
        const visit = (node: any) => {
            if (!node) {
                return;
            }

            if (node.type === 'import_declaration' || node.type === 'import_statement') {
                imports.push(this.trimText(node.text, 120));
                return;
            }

            if (node.type === 'variable_declarator' && node.text.includes('require(')) {
                imports.push(this.trimText(node.text, 120));
                return;
            }

            const children = node.namedChildren || [];
            for (const child of children) {
                if (imports.length >= 3) {
                    break;
                }
                visit(child);
            }
        };

        visit(tree.rootNode);
        return imports.slice(0, 3);
    }

    private trimText(value: string, maxLength: number): string {
        if (value.length <= maxLength) {
            return value.replace(/\n/g, ' ');
        }
        return value.slice(0, maxLength).replace(/\n/g, ' ') + '...';
    }

    /**
     * Retorna o caractere de comentário correto baseado na ID da linguagem
     */
    private getCommentSign(languageId: string): string {
        switch (languageId) {
            case 'python':
            case 'ruby':
                return '#';
            default:
                return '//'; // JS, TS, Java, C++, etc.
        }
    }
}