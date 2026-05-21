import * as vscode from 'vscode';
import { ASTManager } from './astManager';
import { SymbolIndexer } from './symbolIndexer';
import { ContextManager } from './contextManager';

export async function activate(context: vscode.ExtensionContext) {
  console.log('[Kuben] Ativando motor de inteligência contextual...');

  const astManager = ASTManager.getInstance();
  const symbolIndexer = SymbolIndexer.getInstance();
  const contextManager = ContextManager.getInstance();

  await astManager.initialize(context);

  // Registra o provedor de Inline Completion do VS Code
  const inlineProvider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(document, position, context, token) {
      // Evita disparos desnecessários se o cancelamento já foi solicitado
      if (token.isCancellationRequested) return [];

      // Cronometragem fina para nossa telemetria de latência (Target <= 300ms)
      const requestStart = Date.now();

      try {
        // 1. Montagem do payload contextual otimizado
        const fimContext = contextManager.buildFIMContext(document, position);
        
        // [LOG DE TELEMETRIA TEMPORÁRIO] Validação do pipeline de contexto
        console.debug(`[Kuben Telemetry] Contexto preparado em ${Date.now() - requestStart}ms.`);

        // 2. Stub temporário para a Feature 04 (Inference Engine)
        // Retornará vazio até conectarmos o OllamaClient via streaming na próxima fase.
        return [];

      } catch (error) {
        console.error('[Kuben] Erro no pipeline de autocompletar:', error);
        return [];
      }
    }
  };

  // Registra o provedor vinculando-o a todas as linguagens suportadas
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

  console.log('[Kuben] Feature 03: ContextManager totalmente integrado ao InlineCompletionEngine.');
}

export function deactivate() {}