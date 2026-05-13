import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';

export function activate(context: vscode.ExtensionContext) {
  const client = new OllamaClient();

	function createDebounced<T extends any[], R>(
		fn: (...args: T) => Promise<R>,
		delay: number
	) {
		let timeout: NodeJS.Timeout | null = null;
		let pendingResolve: ((value: R | undefined) => void) | null = null;

		return (...args: T): Promise<R | undefined> => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
				if (pendingResolve) {
					pendingResolve(undefined);
					pendingResolve = null;
				}
			}

			return new Promise((resolve) => {
				pendingResolve = resolve;
				timeout = setTimeout(async () => {
					try {
						const result = await fn(...args);
						resolve(result as R | undefined);
					} catch (e) {
						console.error('Debounced function error:', e);
						resolve(undefined);
					} finally {
						pendingResolve = null;
						timeout = null;
					}
				}, delay);
			});
		};
	}

	const debouncedGenerate = createDebounced(
		(prefix: string, suffix: string) => client.generateWithFIM(prefix, suffix),
		300
	);

  const provider = vscode.languages.registerInlineCompletionItemProvider(
    { language: 'javascript' }, // Comece com JS
    {
      async provideInlineCompletionItems(document, position, context, token) {
				// Obter texto completo do arquivo
				const fullText = document.getText();
				
				// Obter as linhas antes do cursor
				const lineNumber = position.line;
				const charPos = position.character;
				const currentLine = document.lineAt(lineNumber).text;
				
				// Pegar até 50 linhas anteriores como contexto
				const startLine = Math.max(0, lineNumber - 50);
				const prefix = document.getText(
					new vscode.Range(startLine, 0, lineNumber, charPos)
				);
				
				// Pegar linhas após o cursor como contexto futuro
				const endLine = Math.min(document.lineCount - 1, lineNumber + 10);
				const suffix = document.getText(
					new vscode.Range(lineNumber, charPos, endLine, 0)
				);

				// Log para debug
				console.log('Prefix length:', prefix.length);
				console.log('Current char:', currentLine[charPos]);

				// Montar prompt FIM e solicitar ao Ollama
				try {
					const completion = await client.generateWithFIM(prefix, suffix);
					if (completion && completion.trim()) {
						return [new vscode.InlineCompletionItem(completion)];
					}
				} catch (err) {
					console.error('Error while requesting completion:', err);
				}

				return [];
			}
    }
  );

  context.subscriptions.push(provider);
}

export function deactivate() {}