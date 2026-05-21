import * as assert from 'assert';
import * as vscode from 'vscode';
import { OllamaClient } from '../../ollamaClient';

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
});
