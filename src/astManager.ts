import * as vscode from 'vscode';
import * as path from 'path';
import Parser from 'web-tree-sitter';

export class ASTManager {
  private static instance: ASTManager | null = null;
  private parser: Parser | null = null;
  private languages: Map<string, Parser.Language> = new Map();
  private isInitialized: boolean = false;
  private initializationError: boolean = false;

  private constructor() { }

  /**
   * Retorna a instância única do ASTManager (Singleton)
   */
  public static getInstance(): ASTManager {
    if (!ASTManager.instance) {
      ASTManager.instance = new ASTManager();
    }
    return ASTManager.instance;
  }

  /**
   * Inicializa o ambiente WASM do tree-sitter e pré-carrega os parsers necessários.
   * Deve ser invocado exclusivamente no activate() da extensão.
   */
  public async initialize(context: vscode.ExtensionContext): Promise<boolean> {
    if (this.isInitialized) {return true;}

    try {
      // Inicializa o módulo WASM base do web-tree-sitter

      // Força a resolução do init e construtor via instância resolvida
      await (Parser as any).init();
      this.parser = new (Parser as any)();


      // Mapeamento de linguagens suportadas pela extensão para seus respectivos arquivos WASM
      const languageWasmMap: Record<string, string> = {
        'javascript': 'tree-sitter-javascript.wasm',
        'typescript': 'tree-sitter-typescript.wasm',
        'javascriptreact': 'tree-sitter-javascript.wasm',
        'typescriptreact': 'tree-sitter-typescript.wasm'
      };

      const storagePath = context.extensionPath;

      // Carrega os binários WASM dinamicamente
      for (const [langId, wasmFile] of Object.entries(languageWasmMap)) {
        const wasmPath = path.join(storagePath, 'parsers', wasmFile);
        try {
          const langModule = await Parser.Language.load(wasmPath);
          this.languages.set(langId, langModule);
          console.log(`[ASTManager] Parser carregado com sucesso para: ${langId}`);
        } catch (err) {
          console.warn(`[ASTManager] Falha ao carregar o parser WASM para ${langId} em ${wasmPath}:`, err);
        }
      }

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('[ASTManager] Erro crítico na inicialização do Engine AST:', error);
      this.initializationError = true;
      return false;
    }
  }

  /**
   * Realiza o parsing de um documento de forma resiliente.
   * Caso o tree-sitter não esteja disponível, executa a estratégia de fallback.
   */
  public async parseDocument(document: vscode.TextDocument): Promise<Parser.Tree | null> {
    const useASTEngine = vscode.workspace.getConfiguration('kuben').get<boolean>('useASTEngine', true);

    if (!this.isInitialized || this.initializationError || !useASTEngine || !this.parser) {
      return this.executeFallbackProvider(document);
    }

    const langModule = this.languages.get(document.languageId);
    if (!langModule) {
      // Se a linguagem específica não tiver parser WASM, recorre ao fallback nativo
      return this.executeFallbackProvider(document);
    }

    try {
      this.parser.setLanguage(langModule);
      const text = document.getText();
      // TODO (F01b): Implementar passagem de árvore antiga para parsing incremental delta
      const tree = this.parser.parse(text);
      return tree;
    } catch (error) {
      console.error(`[ASTManager] Erro ao processar AST para o documento ${document.uri.toString()}:`, error);
      return this.executeFallbackProvider(document);
    }
  }

  /**
   * Estratégia de Fallback: Utiliza a API nativa de símbolos do VS Code quando o WASM falha
   */
  private async executeFallbackProvider(document: vscode.TextDocument): Promise<any | null> {
    console.debug(`[ASTManager] Executando estratégia de fallback para: ${document.languageId}`);
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      );
      // Retorna uma abstração mockada ou estrutura mínima mapeada para não quebrar o fluxo do ContextManager
      return symbols ? { isFallback: true, data: symbols } : null;
    } catch (err) {
      console.error('[ASTManager] Falha crítica no Fallback Provider nativo:', err);
      return null;
    }
  }

  /**
   * Obtém o tipo de nó sintático na posição atual do cursor para tomada de decisões heurísticas (F04)
   */
  public getNodeAtPosition(tree: Parser.Tree, position: vscode.Position): Parser.SyntaxNode | null {
    if (!tree || (tree as any).isFallback) {return null;}

    return tree.rootNode.descendantForPosition({
      row: position.line,
      column: position.character
    });
  }
}