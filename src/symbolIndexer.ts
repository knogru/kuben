import * as vscode from 'vscode';
import * as Parser from 'web-tree-sitter';
import { ASTManager } from './astManager';

export interface SymbolMetadata {
  name: string;
  kind: string;
  range: vscode.Range;
  signature?: string;
}

export interface DocumentSymbols {
  uri: string;
  languageId: string;
  symbols: SymbolMetadata[];
}

export class SymbolIndexer {
  private static instance: SymbolIndexer | null = null;
  private astManager: ASTManager;
  
  // Repositório in-memory para acesso O(1) de símbolos por arquivo
  private symbolCache: Map<string, DocumentSymbols> = new Map();

  private constructor() {
    this.astManager = ASTManager.getInstance();
  }

  /**
   * Retorna a instância única do SymbolIndexer (Singleton)
   */
  public static getInstance(): SymbolIndexer {
    if (!SymbolIndexer.instance) {
      SymbolIndexer.instance = new SymbolIndexer();
    }
    return SymbolIndexer.instance;
  }

  /**
   * Executa a indexação ou reindexação incremental de um único documento.
   * Chamado de forma reativa para evitar gargalos de CPU.
   */
  public async indexDocument(document: vscode.TextDocument): Promise<void> {
    const enabled = vscode.workspace.getConfiguration('kuben').get<boolean>('enableGraphRag', true);
    if (!enabled) return;

    // Filtro básico para linguagens suportadas nesta fase
    const supportedLangs = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'];
    if (!supportedLangs.includes(document.languageId)) return;

    const startTime = Date.now();
    try {
      const tree = await this.astManager.parseDocument(document);
      
      if (!tree) return;

      // Se o ASTManager retornou um mock/fallback nativo por falha do WASM
      if ((tree as any).isFallback) {
        this.indexViaFallbackSymbols(document, (tree as any).data);
        return;
      }

      const extractedSymbols: SymbolMetadata[] = [];
      this.traverseTree(tree.rootNode, document, extractedSymbols);

      this.symbolCache.set(document.uri.toString(), {
        uri: document.uri.toString(),
        languageId: document.languageId,
        symbols: extractedSymbols
      });

      const duration = Date.now() - startTime;
      console.debug(`[SymbolIndexer] Indexação incremental concluída para ${document.uri.fsPath} em ${duration}ms. Encontrados: ${extractedSymbols.length} símbolos.`);
    } catch (error) {
      console.error(`[SymbolIndexer] Falha ao indexar incrementalmente o arquivo ${document.uri.toString()}:`, error);
    }
  }

  /**
   * Varredura recursiva de nós da AST gerada pelo tree-sitter para extração seletiva
   */
  private traverseTree(node: Parser.SyntaxNode, document: vscode.TextDocument, symbols: SymbolMetadata[]): void {
    // Nós de interesse para autocomplete e engenharia de contexto
    const targetTypes = [
      'function_declaration',
      'method_definition',
      'class_declaration',
      'lexical_declaration', // const, let
      'variable_declaration' // var
    ];

    if (targetTypes.includes(node.type)) {
      let name = '';
      const nameNode = node.childForFieldName('name') || node.focusedNode;
      
      if (nameNode) {
        name = nameNode.text;
      } else {
        // Fallback de extração textual caso a API de fields falhe
        const firstLine = document.lineAt(node.startPosition.row).text;
        name = firstLine.substring(node.startPosition.column, node.endPosition.column).split('{')[0].trim();
      }

      const range = new vscode.Range(
        new vscode.Position(node.startPosition.row, node.startPosition.column),
        new vscode.Position(node.endPosition.row, node.endPosition.column)
      );

      // Captura da assinatura/linha de definição do símbolo para injeção limpa no prompt
      const definitionLine = document.lineAt(node.startPosition.row).text.trim();

      symbols.push({
        name: name || 'anonymous',
        kind: node.type,
        range: range,
        signature: definitionLine
      });
    }

    // Navegação profunda na árvore sintática
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.traverseTree(child, document, symbols);
      }
    }
  }

  /**
   * Preenche o cache utilizando os dados recuperados do provedor nativo do VS Code (Estratégia de Fallback)
   */
  private indexViaFallbackSymbols(document: vscode.TextDocument, vscodeSymbols: vscode.DocumentSymbol[]): void {
    const extractedSymbols: SymbolMetadata[] = vscodeSymbols.map(sym => ({
      name: sym.name,
      kind: vscode.SymbolKind[sym.kind],
      range: sym.range,
      signature: document.lineAt(sym.range.start.line).text.trim()
    }));

    this.symbolCache.set(document.uri.toString(), {
      uri: document.uri.toString(),
      languageId: document.languageId,
      symbols: extractedSymbols
    });
    console.debug(`[SymbolIndexer] Cache populado via Fallback Nativo para ${document.uri.fsPath}.`);
  }

  /**
   * Retorna os metadados de símbolos associados a um arquivo específico em O(1)
   */
  public getSymbolsForDocument(uri: vscode.Uri): DocumentSymbols | undefined {
    return this.symbolCache.set ? this.symbolCache.get(uri.toString()) : undefined;
  }

  /**
   * Formata os símbolos coletados no padrão de comentário agnóstico para injeção contextual limpa
   */
  public getFormattedMetadataComments(uri: vscode.Uri): string {
    const docData = this.getSymbolsForDocument(uri);
    if (!docData || docData.symbols.length === 0) return '';

    const isHashComment = ['python', 'ruby', 'yaml'].includes(docData.languageId);
    const commentPrefix = isHashComment ? '# ' : '// ';

    let output = `${commentPrefix}[DEP]: Símbolos locais detectados em ${vscode.workspace.asRelativePath(uri)}\n`;
    
    docData.symbols.slice(0, 10).forEach(sym => {
      output += `${commentPrefix}  - ${sym.name} (${sym.kind.replace('_', ' ')}) -> \`${sym.signature}\`\n`;
    });

    return output;
  }

  /**
   * Remove o documento do cache em caso de fechamento ou deleção do arquivo
   */
  public removeDocument(uri: vscode.Uri): void {
    this.symbolCache.delete(uri.toString());
  }
}