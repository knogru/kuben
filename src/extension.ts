import * as vscode from 'vscode';
import { ASTManager } from './astManager';
import { SymbolIndexer } from './symbolIndexer';

export async function activate(context: vscode.ExtensionContext) {
  console.log('[Kuben] Ativando a extensão e instanciando gerenciadores de contexto...');

  const astManager = ASTManager.getInstance();
  const symbolIndexer = SymbolIndexer.getInstance();

  // 1. Inicializa o motor estrutural básico
  await astManager.initialize(context);

  // 2. Indexa de forma assíncrona os documentos de texto que já estão abertos no editor ativo
  if (vscode.window.activeTextEditor) {
    symbolIndexer.indexDocument(vscode.window.activeTextEditor.document);
  }

  // 3. Ouvinte Incremental de Eventos do Workspace para manter o Cache O(1) sempre atualizado
  const onSaveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
    symbolIndexer.indexDocument(document);
  });

  const onChangeEditorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      symbolIndexer.indexDocument(editor.document);
    }
  });

  const onCloseDisposable = vscode.workspace.onDidCloseTextDocument((document) => {
    symbolIndexer.removeDocument(document.uri);
  });

  // Registra os componentes descartáveis no ciclo de vida do VS Code
  context.subscriptions.push(
    onSaveDisposable,
    onChangeEditorDisposable,
    onCloseDisposable
  );

  console.log('[Kuben] Feature 02: SymbolIndexer registrado e escutando mutações de workspace.');
}

export function deactivate() {
  console.log('[Kuben] Encerrando ciclo de vida da extensão.');
}