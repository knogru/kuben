
import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';
import { ContextManager } from './contextManager';
import { ASTManager } from './astManager';

export async function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('kuben');
	let enabled = config.get<boolean>('enabled', true);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434');
	const model = config.get<string>('model', 'qwen2.5-coder:1.5b');
	let debounceDelay = config.get<number>('debounceDelay', 300);
	let contextWindow = config.get<number>('contextWindow', 30);
	let useASTEngine = config.get<boolean>('useASTEngine', true);

	const client = new OllamaClient(endpoint, model);

	const astManager = await ASTManager.create(useASTEngine);

	// Index currently open documents using ASTManager
	for (const doc of vscode.workspace.textDocuments) {
		if (doc.uri.scheme === 'file') {
			await astManager.indexDocument(doc);
		}
	}

	// Update index on save/open
	const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
		if (doc.uri.scheme === 'file') astManager.indexDocument(doc);
	});

	const openListener = vscode.workspace.onDidOpenTextDocument((doc) => {
		if (doc.uri.scheme === 'file') astManager.indexDocument(doc);
	});

	context.subscriptions.push(saveListener, openListener);

	// Read feature flags and telemetry settings
	let enableGraphRag = config.get<boolean>('enableGraphRag', true);
	let telemetryEnabled = config.get<boolean>('telemetry.enabled', true);
	let telemetryOptIn = config.get<boolean>('telemetry.optIn', false);

	// One-time prompt for dataset collection opt-in
	if (!telemetryOptIn && telemetryEnabled) {
		vscode.window.showInformationMessage(
			'Kuben can collect code snippets to fine-tune local models. No data is sent externally. See settings for privacy controls.',
			'Learn More', 'Dismiss'
		).then((choice) => {
			if (choice === 'Learn More') {
				vscode.env.openExternal(vscode.Uri.parse('https://github.com/knogru/kuben'));
			}
		});
	}

	// In-memory latency samples (ms) for discovery/benchmarking
	const latencySamples: number[] = [];

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

	const contextManager = new ContextManager(astManager);

	const provider = vscode.languages.registerInlineCompletionItemProvider(
		{ language: 'javascript' },
		{
			async provideInlineCompletionItems(document, position, context, token) {
				if (!enabled) return [];

				// Build surgical prefix/suffix using ContextManager (includes symbol metadata comments)
				const { prefix, suffix } = await contextManager.buildPrefixSuffix(document, position, contextWindow);

				try {
					const start = Date.now();
					statusBar.text = '$(sync~spin) Kuben: Generating';
					statusBar.show();
					const completion = await debouncedGenerate(prefix, suffix);
					const elapsed = Date.now() - start;
					latencySamples.push(elapsed);
					console.debug(`Kuben: FIM roundtrip ${elapsed}ms`);
					statusBar.text = `Kuben: Done (${elapsed}ms)`;
					// briefly show the timing
					setTimeout(() => {
						statusBar.hide();
					}, 800);
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

	// Command to inspect latency samples collected during the session
	const showLatencyCmd = vscode.commands.registerCommand('kuben.showLatency', async () => {
		if (latencySamples.length === 0) {
			vscode.window.showInformationMessage('Kuben: no latency samples collected yet');
			return;
		}
		const sum = latencySamples.reduce((a, b) => a + b, 0);
		const avg = Math.round(sum / latencySamples.length);
		const max = Math.max(...latencySamples);
		const min = Math.min(...latencySamples);
		vscode.window.showInformationMessage(`Kuben latency samples — avg ${avg}ms (n=${latencySamples.length}), min ${min}ms, max ${max}ms`);
	});

	context.subscriptions.push(showLatencyCmd);

	// Command to manage telemetry and dataset collection opt-in
	const telemetryCmd = vscode.commands.registerCommand('kuben.manageTelemetry', async () => {
		const choice = await vscode.window.showQuickPick(
			[
				{ label: 'View Latency Stats', description: 'Show collected latency samples' },
				{ label: 'Toggle Telemetry', description: 'Enable/disable latency collection' },
				{ label: 'Toggle Dataset Opt-In', description: 'Enable/disable code snippet collection for fine-tuning' }
			],
			{ placeHolder: 'Kuben Telemetry & Privacy' }
		);

		if (choice?.label === 'View Latency Stats') {
			if (latencySamples.length > 0) {
				const sum = latencySamples.reduce((a, b) => a + b, 0);
				const avg = Math.round(sum / latencySamples.length);
				const max = Math.max(...latencySamples);
				const min = Math.min(...latencySamples);
				vscode.window.showInformationMessage(`Kuben latency — avg ${avg}ms (n=${latencySamples.length}), min ${min}ms, max ${max}ms`);
			} else {
				vscode.window.showInformationMessage('Kuben: no latency samples collected yet');
			}
		} else if (choice?.label === 'Toggle Telemetry') {
			telemetryEnabled = !telemetryEnabled;
			await config.update('telemetry.enabled', telemetryEnabled, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Kuben latency telemetry ${telemetryEnabled ? 'enabled' : 'disabled'}`);
		} else if (choice?.label === 'Toggle Dataset Opt-In') {
			telemetryOptIn = !telemetryOptIn;
			await config.update('telemetry.optIn', telemetryOptIn, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Kuben dataset opt-in ${telemetryOptIn ? 'enabled (collection will begin on next session)' : 'disabled'}`);
		}
	});

	context.subscriptions.push(telemetryCmd);
}

export function deactivate() {}