import { IFimPayload, ISyntaxBounds } from '../domain/types';
import { ITruncationBudget, ITruncationResult, ITruncationMetrics, DEFAULT_TRUNCATION_BUDGET } from '../domain/truncation-types';

export class ActiveTruncator {

    truncatePayload(
        payload: IFimPayload,
        budget: ITruncationBudget = DEFAULT_TRUNCATION_BUDGET,
        bounds: ISyntaxBounds | undefined = undefined,
    ): { result: ITruncationResult; metrics: ITruncationMetrics } {
        const prefixLines = payload.prefix.split('\n');
        const suffixLines = payload.suffix.split('\n');

        const preTruncationChars = payload.prefix.length + payload.suffix.length;
        const preTruncationLines = prefixLines.length + suffixLines.length;

        const tokenEstimate = this.estimateTokens(payload.prefix) + this.estimateTokens(payload.suffix);
        const maxPayloadTokens = budget.maxContextTokens - budget.reservedCompletionTokens;

        let prefix = payload.prefix;
        let suffix = payload.suffix;
        let truncatedPrefix = false;
        let truncatedSuffix = false;
        let reason: string | undefined = undefined;

        if (tokenEstimate <= maxPayloadTokens && prefixLines.length <= budget.maxPrefixLines && suffixLines.length <= budget.maxSuffixLines) {
            return {
                result: {
                    prefix,
                    suffix,
                    originalPrefixLength: payload.prefix.length,
                    originalSuffixLength: payload.suffix.length,
                    truncatedPrefix: false,
                    truncatedSuffix: false,
                    truncatedTokenEstimate: tokenEstimate,
                },
                metrics: {
                    preTruncationChars,
                    postTruncationChars: preTruncationChars,
                    preTruncationLines,
                    postTruncationLines: preTruncationLines,
                    wasAltered: false,
                    reason: undefined,
                },
            };
        }

        const isImportBlock = bounds?.blockType === 'import_declaration';

        if (prefixLines.length > budget.maxPrefixLines) {
            if (isImportBlock) {
                reason = 'import_block_prefix_preserved';
            } else {
                prefix = prefixLines.slice(prefixLines.length - budget.maxPrefixLines).join('\n');
                truncatedPrefix = true;
                reason = 'prefix_exceeded_max_lines';
            }
        }

        if (suffixLines.length > budget.maxSuffixLines) {
            suffix = suffixLines.slice(0, budget.maxSuffixLines).join('\n');
            truncatedSuffix = true;
            if (!reason) { reason = 'suffix_exceeded_max_lines'; }
        }

        const currentEstimate = this.estimateTokens(prefix) + this.estimateTokens(suffix);
        if (currentEstimate > maxPayloadTokens) {
            const excessChars = Math.ceil((currentEstimate - maxPayloadTokens) * 4);
            if (!truncatedPrefix && !isImportBlock) {
                const truncated = this.truncateFromStart(prefix, excessChars);
                prefix = truncated;
                truncatedPrefix = true;
                reason = 'prefix_truncated_by_token_budget';
            } else {
                const truncated = this.truncateFromEnd(suffix, excessChars);
                suffix = truncated;
                truncatedSuffix = true;
                if (!reason) { reason = 'suffix_truncated_by_token_budget'; }
            }
        }

        if (!truncatedPrefix && !truncatedSuffix && this.estimateTokens(prefix) + this.estimateTokens(suffix) > maxPayloadTokens) {
            const excessChars = Math.ceil((this.estimateTokens(prefix) + this.estimateTokens(suffix) - maxPayloadTokens) * 4);
            const truncated = this.truncateFromEnd(suffix, excessChars);
            suffix = truncated;
            truncatedSuffix = true;
            if (!reason) { reason = 'suffix_truncated_by_token_budget'; }
        }

        const postTruncationChars = prefix.length + suffix.length;
        const postTruncationLines = prefix.split('\n').length + suffix.split('\n').length;
        const finalTokenEstimate = this.estimateTokens(prefix) + this.estimateTokens(suffix);

        return {
            result: {
                prefix,
                suffix,
                originalPrefixLength: payload.prefix.length,
                originalSuffixLength: payload.suffix.length,
                truncatedPrefix,
                truncatedSuffix,
                truncatedTokenEstimate: finalTokenEstimate,
            },
            metrics: {
                preTruncationChars,
                postTruncationChars,
                preTruncationLines,
                postTruncationLines,
                wasAltered: truncatedPrefix || truncatedSuffix,
                reason,
            },
        };
    }

    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    private truncateFromStart(text: string, excessChars: number): string {
        if (excessChars >= text.length) {return '';}
        const truncated = text.slice(excessChars);
        const newlineIndex = truncated.indexOf('\n');
        if (newlineIndex === -1) {return truncated;}
        return truncated.slice(newlineIndex + 1);
    }

    private truncateFromEnd(text: string, excessChars: number): string {
        if (excessChars >= text.length) {return '';}
        const keepLength = text.length - excessChars;
        const truncated = text.slice(0, keepLength);
        const lastNewline = truncated.lastIndexOf('\n');
        if (lastNewline === -1) {return truncated;}
        return truncated.slice(0, lastNewline);
    }
}

export default ActiveTruncator;
