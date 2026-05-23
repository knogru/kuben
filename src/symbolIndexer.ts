import * as vscode from 'vscode';

export interface FlattenedSymbol {
    name: string;
    kind: vscode.SymbolKind;
    containerName?: string;
    lineStart: number;
    lineEnd: number;
}

export class SymbolIndexer {
    private cache: Map<string, FlattenedSymbol[]> = new Map();
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {}

    /**
     * Ponto de entrada chamado estritamente na ativação da extensão.
     * Registra os listeners incrementais altamente reativos.
     */
    public initialize(context: vscode.ExtensionContext): void {
        console.log('[Kuben Indexer] Inicializando motor de indexação incremental...');

        // Evento 1: Indexação imediata ao abrir o arquivo
        context.subscriptions.push(
            vscode.workspace.onDidOpenTextDocument(async (document) => {
                await this.indexDocument(document);
            })
        );

        // Evento 2: Indexação reativa em tempo de digitação (Debounce de 1.5s)
        // Evita chamadas excessivas ao Language Server durante digitação contínua
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(async (event) => {
                if (event.document.uri.scheme !== 'file') return;
                this.triggerDebouncedIndexing(event.document);
            })
        );

        // Limpeza de cache ao fechar o documento para evitar vazamento de memória (Memory Leak)
        context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument((document) => {
                const uriStr = document.uri.toString();
                this.cache.delete(uriStr);
                
                const timer = this.debounceTimers.get(uriStr);
                if (timer) {
                    clearTimeout(timer);
                    this.debounceTimers.delete(uriStr);
                }
            })
        );

        // Atualiza o índice ao salvar o arquivo, mantendo o grafo de símbolos consistente.
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(async (document) => {
                if (document.uri.scheme !== 'file') return;
                await this.indexDocument(document);
            })
        );

        // Indexa o documento ativo se houver um na inicialização
        if (vscode.window.activeTextEditor) {
            this.indexDocument(vscode.window.activeTextEditor.document);
        }
    }

    /**
     * Gerencia a fila de debounce por arquivo para garantir reatividade sem gargalos
     */
    private triggerDebouncedIndexing(document: vscode.TextDocument): void {
        const uriStr = document.uri.toString();
        
        const existingTimer = this.debounceTimers.get(uriStr);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(async () => {
            await this.indexDocument(document);
            this.debounceTimers.delete(uriStr);
        }, 1500); // 1.5 segundos sem digitar aciona a reindexação de AST de fundo

        this.debounceTimers.set(uriStr, timer);
    }

    /**
     * Executa a extração determinística e achata a árvore de símbolos para consumo imediato
     */
    private async indexDocument(document: vscode.TextDocument): Promise<void> {
        if (document.uri.scheme !== 'file') return;

        const startTime = performance.now();
        try {
            // Invoca o LSP local de forma assíncrona
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (symbols && symbols.length > 0) {
                const flattened: FlattenedSymbol[] = [];
                this.flattenSymbols(symbols, flattened);
                
                this.cache.set(document.uri.toString(), flattened);
                
                const duration = performance.now() - startTime;
                console.debug(`[Kuben Indexer] ${document.fileName} reindexado em ${duration.toFixed(2)}ms. Símbolos úteis: ${flattened.length}`);
            }
        } catch (error) {
            // Falhas silenciadas para não impactar a experiência de digitação do usuário
            console.debug(`[Kuben Indexer] Provedor de símbolos indisponível no momento para ${document.fileName}`);
        }
    }

    /**
     * Transforma recursivamente a árvore do AST em uma lista linear focada em escopos relevantes
     */
    private flattenSymbols(
        symbols: vscode.DocumentSymbol[], 
        result: FlattenedSymbol[], 
        containerName?: string
    ): void {
        for (const symbol of symbols) {
            // Filtragem seletiva: ignoramos variáveis locais puras dentro de funções para limpar o ruído do Graph RAG
            const isRelevant = [
                vscode.SymbolKind.Class,
                vscode.SymbolKind.Interface,
                vscode.SymbolKind.Method,
                vscode.SymbolKind.Function,
                vscode.SymbolKind.Enum,
                vscode.SymbolKind.Struct
            ].includes(symbol.kind);

            if (isRelevant) {
                result.push({
                    name: symbol.name,
                    kind: symbol.kind,
                    containerName: containerName,
                    lineStart: symbol.range.start.line,
                    lineEnd: symbol.range.end.line
                });
            }

            // Explora recursivamente os filhos (ex: métodos dentro de uma classe)
            if (symbol.children && symbol.children.length > 0) {
                this.flattenSymbols(symbol.children, result, symbol.name);
            }
        }
    }

    /**
     * Recupera a lista achatada de símbolos mapeados no documento
     */
    public getSymbolsForDocument(uri: vscode.Uri): FlattenedSymbol[] {
        return this.cache.get(uri.toString()) || [];
    }

    public getSymbolsForPosition(document: vscode.TextDocument, position: vscode.Position): FlattenedSymbol[] {
        const symbols = this.getSymbolsForDocument(document.uri);
        const line = position.line;
        return symbols.filter(symbol => symbol.lineStart <= line && symbol.lineEnd >= line);
    }
}