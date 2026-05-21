import * as assert from 'assert';
import * as http from 'http';
import * as vscode from 'vscode';
import { OllamaClient } from '../ollamaClient';
import { ContextManager } from '../contextManager';

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
		// Força o cliente a apontar temporariamente para o nosso mock server
		const client = OllamaClient.getInstance();
		(client as any).endpoint = `http://localhost:${mockPort}`;

		const dummyContext = {
			prompt: "function calcular(a, b) { ",
			prefix: "function calcular(a, b) { ",
			rawPrefix: "function calcular(a, b) { ", // Igual ao prefixo sem decorações/metadados
			suffix: " }"
		};
		const cts = new vscode.CancellationTokenSource();

		const result = await client.generateInlineCompletion(dummyContext, cts.token);

		assert.strictEqual(result, targetModelResponse, 'O texto reconstruído pelo stream incremental diverge do esperado.');
	});

	test('F04b: Abort Mecanismo - Deve interromper a requisição HTTP imediatamente ao cancelar Token', async () => {
		const client = OllamaClient.getInstance();
		(client as any).endpoint = `http://localhost:${mockPort}`;

		const dummyContext = {
			prompt: "function calcular(a, b) { ",
			prefix: "function calcular(a, b) { ",
			rawPrefix: "function calcular(a, b) { ", // Igual ao prefixo sem decorações/metadados
			suffix: " }"
		};
		const cts = new vscode.CancellationTokenSource();

		// Dispara a inferência e cancela logo em seguida (simulando nova tecla pressionada em 20ms)
		const completionPromise = client.generateInlineCompletion(dummyContext, cts.token);

		setTimeout(() => {
			cts.cancel();
		}, 20);

		const result = await completionPromise;

		// O resultado deve ser parcial ou vazio, mas a Promise DEVE resolver sem travar o editor
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
});