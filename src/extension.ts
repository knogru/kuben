import * as vscode from 'vscode';
import { ASTManager } from './astManager';
// ... outros imports existentes (OllamaClient, etc.)[cite: 1]

export async function activate(context: vscode.ExtensionContext) {
  console.log('[Kuben] Ativando a extensão e inicializando componentes centrais...');

  // Inicializa o Engine AST sob a restrição de ciclo de vida seguro
  const astManager = ASTManager.getInstance();
  const astInitSuccess = await astManager.initialize(context);
  
  if (astInitSuccess) {
    console.log('[Kuben] Engine AST configurado com sucesso via WebAssembly.');
  } else {
    console.warn('[Kuben] Engine AST operando em modo de Fallback Estrutural.');
  }

  // ... Registro de InlineCompletionItemProvider e comandos subsequentes[cite: 1]
}

export function deactivate() {
  console.log('[Kuben] Encerrando ciclo de vida da extensão.');
}