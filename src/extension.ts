import * as vscode from 'vscode';
import { SymbolIndexer } from './symbolIndexer';
import { OllamaClient } from './ollamaClient';
import { ContextManager } from './contextManager';
import { ASTManager } from './astManager';
import { KubenInlineCompletionProvider } from './completionProvider';

// Interface simples para unificar logs locais de telemetria
class LocalTelemetryService {
	public static logLatency(metricName: string, value: number) {
		// Ponto de extensão para integrar com sistemas de telemetria robustos
		console.debug(`[Kuben Telemetry] ${metricName}: ${value.toFixed(2)}ms`);
	}
}

export async function activate(context: vscode.ExtensionContext) {
	// 0. Inicializa o AST engine em background para suportar análise avançada
	await ASTManager.getInstance().initialize(context);

	// 1. Inicializa o indexador de símbolos primeiro
	const symbolIndexer = new SymbolIndexer();
	symbolIndexer.initialize(context);

	// 2. Injeta as instâncias do symbolIndexer e do ASTManager no construtor do ContextManager
	const contextManager = new ContextManager(symbolIndexer, ASTManager.getInstance());

	// 3. Inicializa o cliente de inferência local
	const ollamaClient = new OllamaClient();

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = 'kuben.checkOllamaConnection';
	statusBarItem.text = 'Kuben: inicializando...';
	statusBarItem.tooltip = 'Clique para verificar a conexão com o servidor Ollama';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	const updateStatusBar = (connected: boolean) => {
		statusBarItem.text = connected ? 'Kuben: Ollama pronto' : 'Kuben: Ollama offline';
		statusBarItem.color = connected ? undefined : new vscode.ThemeColor('errorForeground');
	};

	const provider = new KubenInlineCompletionProvider(
		ollamaClient,
		contextManager,
		symbolIndexer
	);

	// Registra o provedor globalmente aplicando para todos os esquemas e arquivos válidos
	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider({ pattern: '**/*' }, provider)
	);

	// Comando complementar para expor as métricas ao usuário (Princípio 1)
	context.subscriptions.push(
		vscode.commands.registerCommand('kuben.showLatency', () => {
			const metrics = provider.getLatestMetrics();
			if (metrics.totalLatency === 0 && metrics.ttft === 0) {
				vscode.window.showInformationMessage('Kuben: Nenhuma métrica de latência registrada ainda.');
				return;
			}

			vscode.window.showInformationMessage(
				`Kuben Performance — Último TTFT: ${metrics.ttft.toFixed(2)}ms. Total RTT: ${metrics.totalLatency.toFixed(2)}ms. (Alvo TTFT: ≤300ms)`
			);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('kuben.checkOllamaConnection', async () => {
			const connected = await ollamaClient.checkConnection();
			updateStatusBar(connected);
			if (connected) {
				vscode.window.showInformationMessage('Kuben: Conexão com Ollama estabelecida com sucesso.');
			} else {
				vscode.window.showErrorMessage('Kuben: Falha ao conectar no Ollama. Verifique kuben.ollamaUrl e se o servidor está ativo.');
			}
		})
	);

	(async () => {
		const connected = await ollamaClient.checkConnection();
		updateStatusBar(connected);
		if (!connected) {
			statusBarItem.tooltip = 'Kuben não conseguiu conectar ao Ollama. Clique para re-tentar.';
		}
	})();
}

export function deactivate() { }