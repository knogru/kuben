import * as assert from 'assert';
import { ActiveTruncator } from '../application/active-truncator';
import { IncrementalPostProcessor } from '../infrastructure/incremental-post-processor';
import { IFimPayload } from '../domain/types';

suite('ActiveTruncator Test Suite', () => {
    test('payload within budget returns zero modifications', () => {
        const truncator = new ActiveTruncator();
        const payload: IFimPayload = {
            prefix: 'const x = 1;\nconst y = 2;\n',
            suffix: 'console.log(x);\n',
            isSpmFormat: false,
        };

        const { truncatedPayload, metrics } = truncator.truncatePayload(payload, 'source_file');

        assert.strictEqual(truncatedPayload.prefix, payload.prefix);
        assert.strictEqual(truncatedPayload.suffix, payload.suffix);
        assert.strictEqual(metrics.truncationApplied, false);
        assert.strictEqual(metrics.prefixWasTruncated, false);
        assert.strictEqual(metrics.suffixWasTruncated, false);
    });

    test('long prefix is truncated at nearest line break preserving end', () => {
        const truncator = new ActiveTruncator({
            maxContextTokens: 256,
            generationReserve: 24,
            sentinelOverhead: 3,
            graphRagOverhead: 50,
            charToTokenRatio: 4,
            prefixRatio: 0.60,
            suffixRatio: 0.40,
        });

        const lines: string[] = [];
        for (let i = 0; i < 100; i++) {
            lines.push(`// line ${i}`);
        }
        const longPrefix = lines.join('\n') + '\nconst result = 42;\n';

        const payload: IFimPayload = {
            prefix: longPrefix,
            suffix: 'console.log(result);\n',
            isSpmFormat: false,
        };

        const { truncatedPayload, metrics } = truncator.truncatePayload(payload, 'source_file');

        assert.strictEqual(metrics.truncationApplied, true);
        assert.strictEqual(metrics.prefixWasTruncated, true);
        assert.ok(truncatedPayload.prefix.length < payload.prefix.length, 'prefix should be shorter');
        assert.ok(truncatedPayload.prefix.endsWith('const result = 42;\n'), 'prefix should preserve end content');
    });

    test('import_declaration block preserves prefix, truncates only suffix', () => {
        const truncator = new ActiveTruncator({
            maxContextTokens: 128,
            generationReserve: 24,
            sentinelOverhead: 3,
            graphRagOverhead: 50,
            charToTokenRatio: 4,
            prefixRatio: 0.60,
            suffixRatio: 0.40,
        });

        const payload: IFimPayload = {
            prefix: "import { foo } from './bar';\nimport { baz } from './qux';\n",
            suffix: 'x'.repeat(500) + '\n',
            isSpmFormat: false,
        };

        const { truncatedPayload, metrics } = truncator.truncatePayload(payload, 'import_declaration');

        assert.strictEqual(metrics.prefixWasTruncated, false, 'prefix should be preserved for imports');
        assert.strictEqual(metrics.suffixWasTruncated, true, 'suffix should be truncated');
        assert.ok(truncatedPayload.prefix.includes("import { foo }"), 'prefix should preserve imports');
        assert.ok(truncatedPayload.suffix.length < payload.suffix.length, 'suffix should be shorter');
        assert.strictEqual(metrics.truncationApplied, true);
    });

    test('long prefix without newlines falls back to linear cut', () => {
        const truncator = new ActiveTruncator({
            maxContextTokens: 128,
            generationReserve: 24,
            sentinelOverhead: 3,
            graphRagOverhead: 50,
            charToTokenRatio: 4,
            prefixRatio: 0.60,
            suffixRatio: 0.40,
        });

        const singleLine = 'x'.repeat(1000);
        const payload: IFimPayload = {
            prefix: singleLine,
            suffix: 'y',
            isSpmFormat: false,
        };

        const { truncatedPayload, metrics } = truncator.truncatePayload(payload, 'source_file');

        assert.strictEqual(metrics.prefixWasTruncated, true);
        assert.ok(truncatedPayload.prefix.length < payload.prefix.length);
    });
});

suite('IncrementalPostProcessor Test Suite', () => {
    const processor = new IncrementalPostProcessor();

    test('bracket_match with balanced braces does NOT trigger', () => {
        const result = processor.evaluate(
            'function foo() {\n  return 1;\n}',
            '\n',
        );

        assert.strictEqual(result.shouldStop, false);
        assert.strictEqual(result.rule, null);
    });

    test('bracket_match with excess closing brace triggers on first excess', () => {
        const result = processor.evaluate(
            'function foo() {\n  return 1;\n}\n}',
            '}',
        );

        assert.strictEqual(result.shouldStop, true);
        assert.strictEqual(result.rule, 'bracket_match');
        assert.strictEqual(result.cleanedText, 'function foo() {\n  return 1;\n}');
        assert.ok(!result.cleanedText.includes('}}'), 'cleanedText should not contain double braces');
    });

    test('sibling_collision with newline function triggers', () => {
        const result = processor.evaluate(
            '  return 42;\nfunction ',
            '\nfunction bar() {\n  return 7;\n}',
        );

        assert.strictEqual(result.shouldStop, true);
        assert.strictEqual(result.rule, 'sibling_collision');
        assert.ok(!result.cleanedText.includes('\nfunction '));
    });

    test('function inside variable name does NOT trigger sibling_collision', () => {
        const result = processor.evaluate(
            'myFunctionHelper',
            '\nconst x = 1;\n',
        );

        assert.strictEqual(result.shouldStop, false);
    });

    test('empty text does not trigger any stop rule', () => {
        const result = processor.evaluate('', 'suffix');

        assert.strictEqual(result.shouldStop, false);
        assert.strictEqual(result.rule, null);
        assert.strictEqual(result.cleanedText, '');
    });

    test('excess closing brace with suffix not starting with brace does NOT trigger', () => {
        const result = processor.evaluate(
            'function foo() {\n  return 1;\n}\n}',
            '\n',
        );

        assert.strictEqual(result.shouldStop, false);
    });

    test('bracket_match respects open vs close balance', () => {
        const result = processor.evaluate(
            '{ key: value }',
            '}',
        );

        assert.strictEqual(result.shouldStop, false, 'balanced braces should not trigger');
    });

    test('sibling_collision with double newline triggers', () => {
        const result = processor.evaluate(
            'const x = 1;\n\n',
            '\nconst y = 2;\n',
        );

        assert.strictEqual(result.shouldStop, true);
        assert.strictEqual(result.rule, 'sibling_collision');
    });

    test('custom stop sequences override defaults', () => {
        const customProcessor = new IncrementalPostProcessor(['\nCUSTOM_STOP\n']);
        const result = customProcessor.evaluate(
            'before\nCUSTOM_STOP\n',
            'suffix',
        );

        assert.strictEqual(result.shouldStop, true);
        assert.strictEqual(result.rule, 'sibling_collision');
        assert.strictEqual(result.cleanedText, 'before');
    });
});
