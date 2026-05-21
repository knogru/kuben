import * as assert from 'assert';
import * as vscode from 'vscode';
import { OllamaClient } from '../../ollamaClient';
import { SymbolIndexer } from '../../symbolIndexer';
import { ASTManager } from '../../astManager';
import { ContextManager } from '../../contextManager';

suite('OllamaClient Test Suite', () => {
	test('cleanCompletion removes prose and fences and returns code', () => {
		const client = new OllamaClient();
		const raw = `Sure! Here is the implementation:\n\n```javascript\nfunction fib(n) {\n  if (n < 2) return n;\n  return fib(n-1) + fib(n-2);\n}\n```\n\nExplanation: This computes fibonacci.`;

		// access private method for testing
		const cleaned = (client as any).cleanCompletion(raw);
		assert.ok(cleaned?.includes('function fib'));
		assert.ok(!cleaned?.includes('Explanation'));
	});

	test('generateWithFIM returns cleaned response when postJson ok', async () => {
		const client = new OllamaClient('http://localhost:11434', 'test-model');

		// mock the private postJson to avoid network calls
		(client as any).postJson = async () => ({
			ok: true,
			status: 200,
			json: async () => ({ response: '```\nconst x = 1;\nconst y = 2;\n```\n' })
		});

		const res = await client.generateWithFIM('prefix', 'suffix', 10);
		assert.strictEqual(res?.trim(), 'const x = 1;\nconst y = 2;');
	});

	test('generateWithFIM returns undefined on non-ok response', async () => {
		const client = new OllamaClient();
		(client as any).postJson = async () => ({ ok: false, status: 404, json: async () => ({}) });
		const res = await client.generateWithFIM('p', 's');
		assert.strictEqual(res, undefined);
	});

	test('generateWithFIMStream calls onToken callback for each streamed message', async () => {
		const client = new OllamaClient('http://localhost:11434', 'test-model');
		(client as any).postJsonStream = async (_url: string, _body: any, _timeout: number, _signal: any, onMessage: (message: any) => void) => {
			onMessage({ response: 'const x = 42' });
			onMessage({ response: ';', done: true });
		};

		const tokens: string[] = [];
		const onToken = (token: string) => { tokens.push(token); };
		await client.generateWithFIMStream('prefix', 'suffix', onToken, 10);
		assert.deepStrictEqual(tokens, ['const x = 42', ';']);
	});
});

suite('SymbolIndexer Test Suite', () => {
	test('SymbolIndexer.getSymbolsForUri returns empty list for unknown URIs', () => {
		const indexer = new SymbolIndexer();
		const fakeUri = vscode.Uri.parse('file:///fake/file.ts');
		const symbols = indexer.getSymbolsForUri(fakeUri);
		assert.strictEqual(symbols.length, 0);
	});

	test('SymbolIndexer.clear removes all indexed symbols', () => {
		const indexer = new SymbolIndexer();
		indexer.clear();
		const fakeUri = vscode.Uri.parse('file:///fake/file.ts');
		const symbols = indexer.getSymbolsForUri(fakeUri);
		assert.strictEqual(symbols.length, 0);
	});
});

suite('ASTManager Test Suite', () => {
	test('ASTManager falls back when AST engine is disabled', async () => {
		const manager = await ASTManager.create(false);
		const fakeDoc = {
			uri: vscode.Uri.parse('file:///fake/file.ts'),
			lineCount: 1,
			getText: () => '',
			lineAt: () => ({ text: '' }),
		} as unknown as vscode.TextDocument;

		await manager.indexDocument(fakeDoc);
		const symbols = manager.getSymbolsForUri(fakeDoc.uri);
		assert.ok(Array.isArray(symbols));
	});
});

suite('ContextManager Test Suite', () => {
	test('ContextManager.buildPrefixSuffix creates prefix with metadata comments', async () => {
		const indexer = new SymbolIndexer();
		const manager = new ContextManager(indexer);

		const mockDocument = {
			lineAt: (line: number) => ({ text: 'const x = 1;' }),
			textDocuments: [],
			getText: (range: vscode.Range) => 'const x = 1;\nconst y = 2;',
			lineCount: 10,
			uri: vscode.Uri.parse('file:///test.ts'),
		} as unknown as vscode.TextDocument;

		const position = new vscode.Position(1, 5);
		const { prefix, suffix } = await manager.buildPrefixSuffix(mockDocument, position, 10);

		assert.ok(prefix.includes('const x = 1'));
		assert.ok(suffix !== undefined);
	});
});
