import * as assert from 'assert';
import { ActiveTruncator } from '../application/active-truncator';
import { IncrementalPostProcessor } from '../infrastructure/incremental-post-processor';
import { IFimPayload, ISyntaxBounds } from '../domain/types';
import { ITruncationBudget } from '../domain/truncation-types';

suite('ActiveTruncator Test Suite', () => {
    const truncator = new ActiveTruncator();

    test('payload below limit returns zero modifications', () => {
        const payload: IFimPayload = {
            prefix: 'const x = 1;\nconst y = 2;\n',
            suffix: 'console.log(x);\n',
            isSpmFormat: false,
        };

        const budget: ITruncationBudget = {
            maxContextTokens: 1024,
            maxPrefixLines: 60,
            maxSuffixLines: 10,
            reservedCompletionTokens: 24,
        };

        const { result, metrics } = truncator.truncatePayload(payload, budget);

        assert.strictEqual(result.prefix, payload.prefix);
        assert.strictEqual(result.suffix, payload.suffix);
        assert.strictEqual(result.truncatedPrefix, false);
        assert.strictEqual(result.truncatedSuffix, false);
        assert.strictEqual(metrics.wasAltered, false);
    });

    test('long prefix is truncated at nearest line break preserving end', () => {
        const lines: string[] = [];
        for (let i = 0; i < 100; i++) {
            lines.push(`// line ${i}`);
        }
        const prefix = lines.join('\n') + '\nconst result = 42;\n';

        const payload: IFimPayload = {
            prefix,
            suffix: 'console.log(result);\n',
            isSpmFormat: false,
        };

        const budget: ITruncationBudget = {
            maxContextTokens: 1024,
            maxPrefixLines: 10,
            maxSuffixLines: 10,
            reservedCompletionTokens: 24,
        };

        const { result, metrics } = truncator.truncatePayload(payload, budget);

        assert.strictEqual(result.truncatedPrefix, true);
        assert.ok(result.prefix.endsWith('const result = 42;\n'), `expected to end with 'const result = 42;\\n', got: ${result.prefix.slice(-30)}`);
        assert.ok(result.prefix.split('\n').length <= 12, `prefix lines: ${result.prefix.split('\n').length}`);
        assert.strictEqual(metrics.wasAltered, true);
        assert.ok(metrics.reason);
    });

    test('import_declaration block preserves prefix, truncates only suffix', () => {
        const payload: IFimPayload = {
            prefix: "import { foo } from './bar';\nimport { baz } from './qux';\n",
            suffix: 'const x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;\nconst v = 5;\nconst u = 6;\n',
            isSpmFormat: false,
        };

        const bounds: ISyntaxBounds = {
            blockType: 'import_declaration',
            hasValidScope: true,
            startLine: 0,
            endLine: 1,
            isInsideFunction: false,
            isInsideClass: false,
            isInsideBlock: false,
            braceStack: [],
        };

        const budget: ITruncationBudget = {
            maxContextTokens: 1024,
            maxPrefixLines: 60,
            maxSuffixLines: 3,
            reservedCompletionTokens: 24,
        };

        const { result, metrics } = truncator.truncatePayload(payload, budget, bounds);

        assert.strictEqual(result.truncatedPrefix, false);
        assert.strictEqual(result.truncatedSuffix, true);
        assert.ok(result.prefix.includes("import { foo }"), 'prefix should preserve imports');
        assert.strictEqual(result.suffix.split('\n').length, 3, 'suffix should be truncated to 3 lines');
        assert.strictEqual(metrics.wasAltered, true);
    });
});

suite('IncrementalPostProcessor Test Suite', () => {
    const processor = new IncrementalPostProcessor();

    test('bracket_match with balanced braces does NOT trigger', () => {
        const result = processor.evaluate(
            'function foo() {\n  return 1;\n}',
            '\n',
            24,
        );

        assert.strictEqual(result.shouldStop, false);
    });

    test('bracket_match with excess closing brace triggers and removes only excess brace', () => {
        const result = processor.evaluate(
            'function foo() {\n  return 1;\n}\n}',
            '\n',
            24,
        );

        assert.strictEqual(result.shouldStop, true);
        assert.strictEqual(result.reason, 'bracket_match');
        assert.strictEqual(result.accumulatedText, 'function foo() {\n  return 1;\n}\n');
    });

    test('sibling_collision with newline function triggers at boundary', () => {
        const result = processor.evaluate(
            '  return 42;\nfunction ',
            'function bar() {\n  return 7;\n}',
            24,
        );

        assert.strictEqual(result.shouldStop, true);
        assert.strictEqual(result.reason, 'sibling_collision');
        assert.strictEqual(result.accumulatedText, '  return 42;\n');
    });

    test('function inside variable name does NOT trigger sibling_collision', () => {
        const result = processor.evaluate(
            'myFunctionHelper',
            '\nconst x = 1;\n',
            24,
        );

        assert.strictEqual(result.shouldStop, false);
    });

    test('max_tokens triggers when token count exceeds limit', () => {
        const longText = 'x = 1; '.repeat(30);
        const result = processor.evaluate(
            longText,
            '',
            5,
        );

        assert.strictEqual(result.shouldStop, true);
        assert.strictEqual(result.reason, 'max_tokens');
    });

    test('empty text does not trigger any stop rule', () => {
        const result = processor.evaluate('', 'suffix', 24);

        assert.strictEqual(result.shouldStop, false);
        assert.strictEqual(result.reason, undefined);
    });

    test('balanced parentheses and brackets do not trigger bracket_match', () => {
        const result = processor.evaluate(
            'foo([1, 2, 3])',
            '\nbar()',
            24,
        );

        assert.strictEqual(result.shouldStop, false);
    });

    test('excess closing parenthesis triggers bracket_match', () => {
        const result = processor.evaluate(
            'foo(1, 2))',
            '',
            24,
        );

        assert.strictEqual(result.shouldStop, true);
        assert.strictEqual(result.reason, 'bracket_match');
        assert.strictEqual(result.accumulatedText, 'foo(1, 2)');
    });
});
