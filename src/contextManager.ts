import * as vscode from 'vscode';
import { SymbolIndexer } from './symbolIndexer';

export interface FIMContext {
  prompt: string;
  prefix: string;
  suffix: string;
  rawPrefix: string; // Prefixo puro sem injeção de metadados
}

export class ContextManager {
  private static instance: ContextManager | null = null;
  private symbolIndexer: SymbolIndexer;

  // Limites conservadores para garantir a latência de sub-300ms no Ollama local
  private readonly MAX_PREFIX_CHARS = 2500;
  private readonly MAX_SUFFIX_CHARS = 1200;

  private constructor() {
    this.symbolIndexer = SymbolIndexer.getInstance();
  }

  public static getInstance(): ContextManager {
    if (!ContextManager.instance) {
      ContextManager.instance = new ContextManager();
    }
    return ContextManager.instance;
  }

  /**
   * Constrói o contexto FIM ideal combinando buffers do editor e metadados estruturais locais.
   */
  public buildFIMContext(document: vscode.TextDocument, position: vscode.Position): FIMContext {
    const startTime = Date.now();
    const fullText = document.getText();
    const offset = document.offsetAt(position);

    // 1. Extração e truncamento linear dos buffers
    let rawPrefix = fullText.substring(0, offset);
    let suffix = fullText.substring(offset);

    if (rawPrefix.length > this.MAX_PREFIX_CHARS) {
      rawPrefix = rawPrefix.substring(rawPrefix.length - this.MAX_PREFIX_CHARS);
    }
    if (suffix.length > this.MAX_SUFFIX_CHARS) {
      suffix = suffix.substring(0, this.MAX_SUFFIX_CHARS);
    }

    // 2. Resgate de metadados estruturais via Grafo Local (SymbolIndexer) - O(1)
    let metadataPadding = '';
    const useGraphRag = vscode.workspace.getConfiguration('kuben').get<boolean>('enableGraphRag', true);

    if (useGraphRag) {
      metadataPadding = this.symbolIndexer.getFormattedMetadataComments(document.uri);
    }

    // 3. Montagem do prefixo enriquecido (Metadados mascarados + Código do desenvolvedor)
    const enrichedPrefix = metadataPadding ? `${metadataPadding}\n${rawPrefix}` : rawPrefix;

    // 4. Formatação seguindo o padrão de tokens FIM estritos (ex: DeepSeek / Qwen)
    // <|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>
    const prompt = `<|fim_prefix|>${enrichedPrefix}<|fim_suffix|>${suffix}<||fim_middle|>`;

    const duration = Date.now() - startTime;
    console.debug(`[ContextManager] Prompt montado em ${duration}ms. Tamanho total do prompt: ${prompt.length} caracteres.`);

    return {
      prompt,
      prefix: enrichedPrefix,
      suffix,
      rawPrefix
    };
  }
}