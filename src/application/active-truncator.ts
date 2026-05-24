import { IFimPayload } from '../domain/types';
import {
    ITruncationBudget,
    ITruncationResult,
    ITruncationMetrics,
    DEFAULT_TRUNCATION_BUDGET,
} from '../domain/truncation-types';

export class ActiveTruncator {
    private readonly budget: ITruncationBudget;
    private readonly availableTokens: number;
    private readonly maxPrefixChars: number;
    private readonly maxSuffixChars: number;

    constructor(budget: ITruncationBudget = DEFAULT_TRUNCATION_BUDGET) {
        this.budget = budget;
        this.availableTokens = budget.maxContextTokens
            - budget.generationReserve
            - budget.sentinelOverhead
            - budget.graphRagOverhead;
        this.maxPrefixChars = Math.floor(this.availableTokens * budget.prefixRatio * budget.charToTokenRatio);
        this.maxSuffixChars = Math.floor(this.availableTokens * budget.suffixRatio * budget.charToTokenRatio);
    }

    truncatePayload(
        payload: IFimPayload,
        blockType: string,
    ): ITruncationResult {
        const originalCharCount = payload.prefix.length + payload.suffix.length;
        const prefixTokens = Math.ceil(payload.prefix.length / this.budget.charToTokenRatio);
        const suffixTokens = Math.ceil(payload.suffix.length / this.budget.charToTokenRatio);
        const totalTokens = prefixTokens + suffixTokens;

        if (totalTokens <= this.availableTokens) {
            return {
                truncatedPayload: payload,
                metrics: {
                    originalCharCount,
                    truncatedCharCount: originalCharCount,
                    estimatedOriginalTokens: totalTokens,
                    estimatedTruncatedTokens: totalTokens,
                    prefixWasTruncated: false,
                    suffixWasTruncated: false,
                    truncationApplied: false,
                },
            };
        }

        const preserveFullPrefix = blockType === 'import_statement' || blockType === 'import_declaration';

        let truncatedPrefix: string;
        let prefixWasTruncated: boolean;

        if (preserveFullPrefix || payload.prefix.length <= this.maxPrefixChars) {
            truncatedPrefix = payload.prefix;
            prefixWasTruncated = false;
        } else {
            const targetCutOffset = payload.prefix.length - this.maxPrefixChars;
            const lineBreakIndex = payload.prefix.indexOf('\n', targetCutOffset);
            if (lineBreakIndex !== -1) {
                truncatedPrefix = payload.prefix.substring(lineBreakIndex + 1);
            } else {
                truncatedPrefix = payload.prefix.substring(targetCutOffset);
            }
            prefixWasTruncated = true;
        }

        let truncatedSuffix: string;
        let suffixWasTruncated: boolean;

        if (payload.suffix.length <= this.maxSuffixChars) {
            truncatedSuffix = payload.suffix;
            suffixWasTruncated = false;
        } else {
            truncatedSuffix = payload.suffix.substring(0, this.maxSuffixChars);
            suffixWasTruncated = true;
        }

        const finalCharCount = truncatedPrefix.length + truncatedSuffix.length;
        const finalTokens = Math.ceil(finalCharCount / this.budget.charToTokenRatio);

        return {
            truncatedPayload: {
                prefix: truncatedPrefix,
                suffix: truncatedSuffix,
                isSpmFormat: payload.isSpmFormat,
            },
            metrics: {
                originalCharCount,
                truncatedCharCount: finalCharCount,
                estimatedOriginalTokens: totalTokens,
                estimatedTruncatedTokens: finalTokens,
                prefixWasTruncated,
                suffixWasTruncated,
                truncationApplied: prefixWasTruncated || suffixWasTruncated,
            },
        };
    }
}

export default ActiveTruncator;
