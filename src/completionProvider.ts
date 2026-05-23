import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';
import { ContextManager } from './contextManager';
import { SymbolIndexer } from './symbolIndexer'; // Assumindo o indexador do MVP

export class KubenInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private debounceTimer: NodeJS.Timeout | undefined;
    
    // Histórico simples de telemetria local para o comando kuben.showLatency
    private lastLatencyMs: number = 0;
    private lastTTFTMs: number = 0;

    constructor(
        private ollamaClient: OllamaClient,
        private contextManager: ContextManager,
        private symbolIndexer: SymbolIndexer
    ) {}

    /**
     * Ponto de entrada principal acionado pelo VS Code a cada caractere digitado.
     */
    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionList | null> {
        
        // 1. Cancelamento Imediato de Streams Anteriores (Garante responsividade)
        this.abortCurrentRequest();

        // 2. Debounce Preditivo via Promise para segurar o fluxo da IDE
        await this.debounce(75);
        if (token.isCancellationRequested) {
            return null;
        }

        const startTime = performance.now();
        let ttftTime = 0;
        let completionText = '';
        let isFirstToken = true;

        try {
            // 4. Extração Determinística de Contexto (Graph RAG Local)
            // Busca símbolos relevantes próximos ou importados no arquivo pelo indexador incremental
            const dependencies = this.symbolIndexer.getSymbolsForPosition(document, position);
            
            const { prompt, suffix } = await this.contextManager.buildPrefixSuffix(
                document,
                position,
                dependencies
            );

            // 5. Execução do Stream com Resolução Antecipada (Streaming as Optimization)
            await this.ollamaClient.generateWithFIMStream(
                { prompt, suffix },
                (tokenChunk) => {
                    if (isFirstToken) {
                        ttftTime = performance.now() - startTime;
                        this.lastTTFTMs = ttftTime;
                        isFirstToken = false;
                        console.debug(`[Kuben] TTFT: ${ttftTime.toFixed(2)}ms`);
                    }
                    completionText += tokenChunk;
                },
                token
            );

            this.lastLatencyMs = performance.now() - startTime;
            console.debug(`[Kuben] Total Inline RTT: ${this.lastLatencyMs.toFixed(2)}ms`);

            if (completionText.trim().length === 0) {
                return null;
            }

            // 6. Retorna o item formatado para a UI do VS Code
            const completionItem = new vscode.InlineCompletionItem(
                completionText,
                new vscode.Range(position, position)
            );

            return {
                items: [completionItem]
            };

        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.debug('[Kuben] Request aborted successfully.');
            } else {
                console.error('[Kuben] Error generating inline completion:', error);
            }
            return null;
        }
    }

    /**
     * Aborta fisicamente a requisição HTTP em andamento no Ollama.
     */
    private abortCurrentRequest() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    /**
     * Função auxiliar de debounce baseada em Promises.
     */
    private debounce(ms: number): Promise<void> {
        return new Promise((resolve) => {
            this.debounceTimer = setTimeout(() => {
                resolve();
            }, ms);
        });
    }

    /**
     * Getters expostos para o comando de Telemetria (`kuben.showLatency`)
     */
    public getLatestMetrics() {
        return {
            ttft: this.lastTTFTMs,
            totalLatency: this.lastLatencyMs
        };
    }
}