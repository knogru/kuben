import { IStreamEvaluationResult, TStopTokenRule } from '../domain/truncation-types';

const STOP_SEQUENCES: string[] = [
    '\nfunction ',
    '\nclass ',
    '\nif ',
    '\nfor ',
    '\nwhile ',
    '\nswitch ',
    '\ntry ',
    '\ncatch ',
    '\nfinally ',
    '\nconst ',
    '\nlet ',
    '\nvar ',
    '\nimport ',
    '\nexport ',
    '\nreturn ',
    '\n}\n',
];

const OPEN_BRACKETS = '([{';
const CLOSE_BRACKETS = ')]}';

export class IncrementalPostProcessor {

    evaluate(
        accumulatedText: string,
        referenceSuffix: string,
        maxTokens: number = 24,
    ): IStreamEvaluationResult {
        const trimmed = accumulatedText.trimEnd();
        if (!trimmed) {
            return { shouldStop: false, reason: undefined, stopOffset: 0, accumulatedText };
        }

        const bracketResult = this.evaluateBracketMatch(trimmed, referenceSuffix);
        if (bracketResult.shouldStop) {
            return bracketResult;
        }

        const collisionResult = this.evaluateSiblingCollision(accumulatedText, referenceSuffix);
        if (collisionResult.shouldStop) {
            return collisionResult;
        }

        const tokenCount = this.estimateTokens(trimmed);
        if (tokenCount >= maxTokens) {
            return {
                shouldStop: true,
                reason: 'max_tokens',
                stopOffset: trimmed.length,
                accumulatedText: trimmed,
            };
        }

        return { shouldStop: false, reason: undefined, stopOffset: 0, accumulatedText: trimmed };
    }

    private evaluateBracketMatch(text: string, suffix: string): IStreamEvaluationResult {
        const textOpen = this.countBrackets(text, OPEN_BRACKETS);
        const textClose = this.countBrackets(text, CLOSE_BRACKETS);

        if (textClose <= textOpen) {
            return { shouldStop: false, reason: undefined, stopOffset: 0, accumulatedText: text };
        }

        const suffixOpen = this.countBrackets(suffix, OPEN_BRACKETS);
        const suffixClose = this.countBrackets(suffix, CLOSE_BRACKETS);

        const totalOpen = textOpen + suffixOpen;
        const totalClose = textClose + suffixClose;

        if (totalClose <= totalOpen) {
            return { shouldStop: false, reason: undefined, stopOffset: 0, accumulatedText: text };
        }

        const excessClose = totalClose - totalOpen;
        let stopOffset = text.length;
        let excessFound = 0;
        for (let i = text.length - 1; i >= 0; i--) {
            const ch = text[i];
            if (CLOSE_BRACKETS.includes(ch)) {
                excessFound++;
                if (excessFound === excessClose) {
                    stopOffset = i;
                    break;
                }
            }
        }

        return {
            shouldStop: true,
            reason: 'bracket_match',
            stopOffset,
            accumulatedText: text.slice(0, stopOffset),
        };
    }

    private evaluateSiblingCollision(text: string, suffix: string): IStreamEvaluationResult {
        for (const seq of STOP_SEQUENCES) {
            if (text.endsWith(seq)) {
                const suffixTrimmed = suffix.trimStart();
                const seqTrimmed = seq.trimStart();
                if (suffixTrimmed.startsWith(seqTrimmed) || suffixTrimmed.startsWith(seqTrimmed.slice(0, -1))) {
                    const seqStartIndex = text.length - seq.length;
                    if (seq.startsWith('\n')) {
                        const stopOffset = seqStartIndex + 1;
                        return {
                            shouldStop: true,
                            reason: 'sibling_collision',
                            stopOffset,
                            accumulatedText: text.slice(0, stopOffset),
                        };
                    }
                    return {
                        shouldStop: true,
                        reason: 'sibling_collision',
                        stopOffset: seqStartIndex,
                        accumulatedText: text.slice(0, seqStartIndex),
                    };
                }
            }
        }

        return { shouldStop: false, reason: undefined, stopOffset: 0, accumulatedText: text };
    }

    private countBrackets(text: string, brackets: string): number {
        let count = 0;
        for (const ch of text) {
            if (brackets.includes(ch)) {
                count++;
            }
        }
        return count;
    }

    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }
}

export default IncrementalPostProcessor;
