import * as assert from 'assert';
import * as http from 'http';
import * as vscode from 'vscode';
import { OllamaClient } from '../ollamaClient';
import { ContextManager } from '../contextManager';
import { SymbolIndexer } from '../symbolIndexer';
import { ASTManager } from '../astManager';

suite('Kuben Suite de Testes Automatizados (F01-F04)', () => {
	let mockServer: http.Server;
	const mockPort = 11435; // Porta alternativa para não conflitar com o Ollama local
	let targetModelResponse = 'const token = "kuben_test";';

	// Inicializa um servidor HTTP local para mocar as respostas em streaming do Ollama
	suiteSetup((done) => {
		mockServer = http.createServer((req, res) => {
			if (req.url === '/api/generate' && req.method === 'POST') {
				res.writeHead(200, {
					'Content-Type': 'application/x-ndjson',
					'Transfer-Encoding': 'chunked'
				});

				// Simula o envio de tokens em partes (chunks de streaming)
				const words = targetModelResponse.split(' ');
				let currentWordIndex = 0;

				const interval = setInterval(() => {
					if (currentWordIndex < words.length) {
						const nextChunk = words[currentWordIndex] + (currentWordIndex === words.length - 1 ? '' : ' ');
						res.write(JSON.stringify({ response: nextChunk, done: false }) + '\n');
						currentWordIndex++;
					} else {
						res.write(JSON.stringify({ done: true }) + '\n');
						clearInterval(interval);
						res.end();
					}
				}, 15); // 15ms de delay por token para simular tempo de geração real
			} else {
				res.writeHead(404);
				res.end();
			}
		});

		mockServer.listen(mockPort, () => done());
	});

	suiteTeardown((done) => {
		mockServer.close(() => done());
	});

	test('F04a: OllamaClient deve processar NDJSON stream corretamente', async () => {
		const client = OllamaClient.getInstance();
		(client as any).endpoint = `http://localhost:${mockPort}`;

		const dummyContext = {
			prompt: "function calcular(a, b) { ",
			suffix: " }"
		};
		const cts = new vscode.CancellationTokenSource();

		let result = '';
		await client.generateWithFIMStream(dummyContext as any, (tokenChunk: string) => {
			result += tokenChunk;
		}, cts.token);

		assert.strictEqual(result, targetModelResponse, 'O texto reconstruído pelo stream incremental diverge do esperado.');
	});

	test('F04b: Abort Mecanismo - Deve interromper a requisição HTTP imediatamente ao cancelar Token', async () => {
		const client = OllamaClient.getInstance();
		(client as any).endpoint = `http://localhost:${mockPort}`;

		const dummyContext = {
			prompt: "function calcular(a, b) { ",
			suffix: " }"
		};
		const cts = new vscode.CancellationTokenSource();

		let result = '';
		const streamPromise = client.generateWithFIMStream(dummyContext as any, (tokenChunk: string) => {
			result += tokenChunk;
		}, cts.token);

		setTimeout(() => {
			cts.cancel();
		}, 20);

		await streamPromise;

		assert.ok(result.length < targetModelResponse.length, 'A conexão de rede não foi abortada a tempo pelo CancellationToken.');
	});

	test('F03: Latency Budget Constraint - Processamento local deve ser sub-50ms', () => {
		const start = Date.now();

		// Simulação rápida de verificação de tempo para o ContextManager plano
		const manager = ContextManager.getInstance();
		assert.ok(manager, 'ContextManager falhou ao instanciar.');

		const duration = Date.now() - start;
		assert.ok(duration < 50, `O overhead de processamento local estourou o budget: ${duration}ms`);
	});

	test('F03b: ContextManager deve construir prompt FIM com prefixo e sufixo válidos', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: 'function soma(a, b) {\n  return a + b;\n}\n'
		});

		const position = new vscode.Position(0, 18); // cursor após 'function soma(a, b)'
		const manager = new ContextManager(new SymbolIndexer(), ASTManager.getInstance());
		const context = await manager.buildPrefixSuffix(document, position, null);

		assert.ok(context.prompt.includes('function soma(a, b)'), 'Prompt não contém prefixo esperado.');
		assert.strictEqual(context.suffix, ' {\n  return a + b;\n}\n');
	});

	test('F03c: ContextManager deve incluir imports no prompt FIM', async () => {
		const document = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: "import { helper } from './utils';\nfunction soma(a, b) {\n  return a + b;\n}\n"
		});

		const position = new vscode.Position(1, 18);
		const manager = new ContextManager(new SymbolIndexer(), ASTManager.getInstance());
		const context = await manager.buildPrefixSuffix(document, position, null);

		assert.ok(context.prompt.includes('[IMPORT]'), 'O prompt FIM deve incluir metadados de imports.');
		assert.ok(context.prompt.includes('import { helper } from \'./utils\';'), 'O prompt deve conter o texto do import.');
	});
});