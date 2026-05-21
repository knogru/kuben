import * as vscode from 'vscode';
import { ASTManager } from './astManager';
import { SymbolIndexer } from './symbolIndexer';
import { ContextManager } from './contextManager';
import { OllamaClient } from './ollamaClient';

export async function activate(context: vscode.ExtensionContext) {
  console.log('[Kuben] Inicializando subsistemas...');

  const astManager = ASTManager.getInstance();
  const symbolIndexer = SymbolIndexer.getInstance();
  const contextManager = ContextManager.getInstance();
  const ollamaClient = OllamaClient.getInstance();

  await astManager.initialize(context);

  const inlineProvider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(document, position, context, token) {
      if (token.isCancellationRequested) {return [];}

      const requestStart = Date.now();

      // Debounce implícito controlado pelo VS Code Inline API + Verificação de segurança
      // Adiciona um pequeno atraso de segurança para digitação ultra rápida se necessário
      await new Promise(resolve => setTimeout(resolve, 35));
      if (token.isCancellationRequested) {return [];}

      try {
        // 1. Geração do Contexto FIM enriquecido com Grafo de Símbolos Local
        const fimContext = contextManager.buildFIMContext(document, position);

        // 2. Disparo da Inferência por Streaming Otimizado
        const completionText = await ollamaClient.generateInlineCompletion(fimContext, token);

        const totalLatency = Date.now() - requestStart;
        console.log(`[Kuben Telemetry] Concluído em ${totalLatency}ms. Texto gerado: "${completionText.replace(/\n/g, '\\n')}"`);

				latencyHistory.push(totalLatency);
				if (latencyHistory.length > 50) {latencyHistory.shift();} // Mantém apenas os últimos 50 inputs

        if (!completionText || completionText.trim().length === 0) {
          return [];
        }

        // 3. Empacotamento do resultado no formato nativo do VS Code Editor
        const completionRange = new vscode.Range(position, position);
        const inlineItem = new vscode.InlineCompletionItem(completionText, completionRange);

        return [inlineItem];

      } catch (error) {
        console.error('[Kuben Engine Error]:', error);
        return [];
      }
    }
  };

  const selector = [
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'javascriptreact' },
    { scheme: 'file', language: 'typescriptreact' }
  ];

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(selector, inlineProvider),
    vscode.workspace.onDidSaveTextDocument(doc => symbolIndexer.indexDocument(doc)),
    vscode.window.onDidChangeActiveTextEditor(editor => editor && symbolIndexer.indexDocument(editor.document)),
    vscode.workspace.onDidCloseTextDocument(doc => symbolIndexer.removeDocument(doc.uri))
  );

  console.log('[Kuben Core] Extensão Kuben totalmente operacional. Pronto para autocompletar local.');

	// Banco de dados em memória simples para telemetria local
const latencyHistory: number[] = [];

// Registre o comando para o usuário visualizar a performance
context.subscriptions.push(
  vscode.commands.registerCommand('kuben.showLatency', () => {
    if (latencyHistory.length === 0) {
      vscode.window.showInformationMessage('Kuben Telemetry: Nenhuma inferência executada ainda.');
      return;
    }
    
    const avg = latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length;
    const max = Math.max(...latencyHistory);
    
    vscode.window.showInformationMessage(
      `📊 Kuben Performance — Média: ${avg.toFixed(1)}ms | Máxima: ${max}ms (Target: ≤300ms)`
    );
  })
);
}

export function deactivate() {}