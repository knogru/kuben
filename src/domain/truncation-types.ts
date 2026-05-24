export interface ITruncationBudget {
    maxContextTokens: number;
    maxPrefixLines: number;
    maxSuffixLines: number;
    reservedCompletionTokens: number;
}

export const DEFAULT_TRUNCATION_BUDGET: ITruncationBudget = {
    maxContextTokens: 1024,
    maxPrefixLines: 60,
    maxSuffixLines: 10,
    reservedCompletionTokens: 24,
};

export interface ITruncationResult {
    prefix: string;
    suffix: string;
    originalPrefixLength: number;
    originalSuffixLength: number;
    truncatedPrefix: boolean;
    truncatedSuffix: boolean;
    truncatedTokenEstimate: number;
}

export interface ITruncationMetrics {
    preTruncationChars: number;
    postTruncationChars: number;
    preTruncationLines: number;
    postTruncationLines: number;
    wasAltered: boolean;
    reason: string | undefined;
}

export type TStopTokenRule = 'bracket_match' | 'sibling_collision' | 'max_tokens';

export interface IStreamEvaluationResult {
    shouldStop: boolean;
    reason: TStopTokenRule | undefined;
    stopOffset: number;
    accumulatedText: string;
}
