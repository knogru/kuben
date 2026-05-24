import { TStopTokenRule, IStreamEvaluationResult } from '../domain/truncation-types';

const DEFAULT_STOP_SEQUENCES: readonly string[] = [
    '\nfunction ',
    '\nclass ',
    '\nconst ',
    '\nexport ',
    '\ninterface ',
    '\ntype ',
    '\n\n',
] as const;

export class IncrementalPostProcessor {
    private readonly stopSequences: readonly string[];

    constructor(customStopSequences?: readonly string[]) {
        this.stopSequences = customStopSequences ?? DEFAULT_STOP_SEQUENCES;
    }

    evaluate(
        accumulatedText: string,
        referenceSuffix: string,
    ): IStreamEvaluationResult {
        if (accumulatedText.length === 0) {
            return { shouldStop: false, rule: null, cleanedText: '' };
        }

        const trimmedSuffix = referenceSuffix.trimStart();

        const bracketResult = this.evaluateBracketMatch(accumulatedText, trimmedSuffix);
        if (bracketResult.shouldStop) {
            return bracketResult;
        }

        const collisionResult = this.evaluateSiblingCollision(accumulatedText);
        if (collisionResult.shouldStop) {
            return collisionResult;
        }

        return { shouldStop: false, rule: null, cleanedText: accumulatedText };
    }

    private evaluateBracketMatch(text: string, trimmedSuffix: string): IStreamEvaluationResult {
        if (!trimmedSuffix.startsWith('}')) {
            return { shouldStop: false, rule: null, cleanedText: text };
        }

        const openCount = text.split('{').length - 1;
        const closeCount = text.split('}').length - 1;

        if (closeCount <= openCount) {
            return { shouldStop: false, rule: null, cleanedText: text };
        }

        const excessClose = closeCount - openCount;
        let foundExcess = 0;
        let firstExcessIndex = -1;

        for (let i = 0; i < text.length; i++) {
            if (text[i] === '}') {
                foundExcess++;
                if (foundExcess === openCount + 1) {
                    firstExcessIndex = i;
                    break;
                }
            }
        }

        if (firstExcessIndex === -1) {
            return { shouldStop: false, rule: null, cleanedText: text };
        }

        const cleanedText = text.substring(0, firstExcessIndex).trimEnd();

        return {
            shouldStop: true,
            rule: 'bracket_match',
            cleanedText,
        };
    }

    private evaluateSiblingCollision(text: string): IStreamEvaluationResult {
        for (const seq of this.stopSequences) {
            const idx = text.indexOf(seq);
            if (idx !== -1) {
                const cleanedText = text.substring(0, idx).trimEnd();
                return {
                    shouldStop: true,
                    rule: 'sibling_collision',
                    cleanedText,
                };
            }
        }

        return { shouldStop: false, rule: null, cleanedText: text };
    }
}

export default IncrementalPostProcessor;
