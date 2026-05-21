import * as vscode from 'vscode';
import { SymbolIndexer, SymbolLocation } from './symbolIndexer';

export class ASTManager {
  private static instance: ASTManager | null = null;
  private indexer: SymbolIndexer = new SymbolIndexer();
  private parserLoaded = false;
  private useASTEngine: boolean;

  private constructor(useASTEngine: boolean) {
    this.useASTEngine = useASTEngine;
  }

  static async create(useASTEngine: boolean): Promise<ASTManager> {
    if (!ASTManager.instance) {
      ASTManager.instance = new ASTManager(useASTEngine);
      await ASTManager.instance.initialize();
    }
    return ASTManager.instance;
  }

  private async initialize() {
    if (!this.useASTEngine) {
      console.debug('ASTManager: AST engine disabled, using fallback indexing.');
      return;
    }

    try {
      const Parser = await import('web-tree-sitter');
      await Parser.default.init();
      this.parserLoaded = true;
      console.debug('ASTManager: web-tree-sitter initialized successfully.');
    } catch (error) {
      console.warn('ASTManager: web-tree-sitter failed to initialize, falling back to DocumentSymbol.', error);
      this.parserLoaded = false;
    }
  }

  async indexDocument(document: vscode.TextDocument) {
    if (document.uri.scheme !== 'file') {
      return;
    }

    if (this.parserLoaded) {
      // Future implementation: parse document via tree-sitter and index syntax nodes.
      // For now, fall back to DocumentSymbol provider until grammar binaries are available.
      await this.indexer.indexDocument(document);
      return;
    }

    await this.indexer.indexDocument(document);
  }

  getSymbolsForUri(uri: vscode.Uri): SymbolLocation[] {
    return this.indexer.getSymbolsForUri(uri);
  }

  async getSymbolsNear(document: vscode.TextDocument, position: vscode.Position): Promise<SymbolLocation[]> {
    const symbols = this.getSymbolsForUri(document.uri);
    return symbols
      .filter((symbol) => symbol.range.end.line <= position.line)
      .sort((a, b) => a.range.start.line - b.range.start.line);
  }
}

export default ASTManager;
