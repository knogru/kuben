import { IFimPayload } from './types';

export interface ITruncationBudget {
    readonly maxContextTokens: number;
    readonly generationReserve: number;
    readonly sentinelOverhead: number;
    readonly graphRagOverhead: number;
    readonly charToTokenRatio: number;
    readonly prefixRatio: number;
    readonly suffixRatio: number;
}

export const DEFAULT_TRUNCATION_BUDGET: ITruncationBudget = {
    maxContextTokens: 1024,
    generationReserve: 24,
    sentinelOverhead: 3,
    graphRagOverhead: 50,
    charToTokenRatio: 4,
    prefixRatio: 0.60,
    suffixRatio: 0.40,
} as const;

export interface ITruncationMetrics {
    readonly originalCharCount: number;
    readonly truncatedCharCount: number;
    readonly estimatedOriginalTokens: number;
    readonly estimatedTruncatedTokens: number;
    readonly prefixWasTruncated: boolean;
    readonly suffixWasTruncated: boolean;
    readonly truncationApplied: boolean;
}

export interface ITruncationResult {
    readonly truncatedPayload: IFimPayload;
    readonly metrics: ITruncationMetrics;
}

export type TStopTokenRule = 'bracket_match' | 'sibling_collision' | 'eof_reached';

export interface IStreamEvaluationResult {
    readonly shouldStop: boolean;
    readonly rule: TStopTokenRule | null;
    readonly cleanedText: string;
}
