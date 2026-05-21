
import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';

export function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('kuben');
	let enabled = config.get<boolean>('enabled', true);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434');
	const model = config.get<string>('model', 'qwen2.5-coder:1.5b');
	let debounceDelay = config.get<number>('debounceDelay', 300);
	let contextWindow = config.get<number>('contextWindow', 30);

	const client = new OllamaClient(endpoint, model);

	// Status bar item for generation state and cancellation
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBar.command = 'kuben.cancel';
	statusBar.tooltip = 'Click to cancel Kuben generation';
	context.subscriptions.push(statusBar);

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

	let debouncedGenerate = createDebounced(
		(prefix: string, suffix: string) => client.generateWithFIM(prefix, suffix),
		debounceDelay
	);

	const provider = vscode.languages.registerInlineCompletionItemProvider(
		{ language: 'javascript' },
		{
			async provideInlineCompletionItems(document, position, context, token) {
				if (!enabled) return [];

				const lineNumber = position.line;
				const charPos = position.character;
				const currentLine = document.lineAt(lineNumber).text;

				// Limitar contexto para não sobrecarregar o modelo
				const MAX_CONTEXT_LINES = contextWindow;
				const startLine = Math.max(0, lineNumber - MAX_CONTEXT_LINES);
				const prefix = document.getText(
					new vscode.Range(startLine, 0, lineNumber, charPos)
				);

				const endLine = Math.min(document.lineCount - 1, lineNumber + 5);
				const suffix = document.getText(
					new vscode.Range(lineNumber, charPos, endLine, 0)
				);

				try {
					statusBar.text = '$(sync~spin) Kuben: Generating';
					statusBar.show();
					const completion = await debouncedGenerate(prefix, suffix);
					if (completion && completion.trim()) {
						return [new vscode.InlineCompletionItem(completion)];
					}
				} catch (err) {
					console.error('Error while requesting completion:', err);
				} finally {
					statusBar.hide();
				}

				return [];
			},
		}
	);

	context.subscriptions.push(provider);

	// Register toggle command
	const toggleCmd = vscode.commands.registerCommand('kuben.toggle', async () => {
		enabled = !enabled;
		await config.update('enabled', enabled, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`Kuben autocomplete ${enabled ? 'enabled' : 'disabled'}`);
	});

	context.subscriptions.push(toggleCmd);

	// Register cancel command
	const cancelCmd = vscode.commands.registerCommand('kuben.cancel', () => {
		try {
			(client as any).cancel();
			statusBar.hide();
			vscode.window.showInformationMessage('Kuben generation cancelled');
		} catch (e) {
			// ignore
		}
	});

	context.subscriptions.push(cancelCmd);

	// Watch for configuration changes and update runtime values
	const cfgListener = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('kuben.debounceDelay') || e.affectsConfiguration('kuben.model') || e.affectsConfiguration('kuben.endpoint') || e.affectsConfiguration('kuben.contextWindow')) {
			const newCfg = vscode.workspace.getConfiguration('kuben');
			debounceDelay = newCfg.get<number>('debounceDelay', debounceDelay);
			contextWindow = newCfg.get<number>('contextWindow', contextWindow);
			// recreate client and debounced function with new settings
			const newEndpoint = newCfg.get<string>('endpoint', endpoint);
			const newModel = newCfg.get<string>('model', model);
			// Note: recreating client instance to pick up new endpoint/model
			// (could be optimized to update internal fields)
			// @ts-ignore - reassign client variable is fine here for runtime
			(client as any).endpoint = newEndpoint;
			(client as any).model = newModel;
			debouncedGenerate = createDebounced((prefix: string, suffix: string) => (client as any).generateWithFIM(prefix, suffix), debounceDelay);
		}
	});

	context.subscriptions.push(cfgListener);
}

export function deactivate() {}
export function deactivate() {}