import * as vscode from 'vscode';
import { IFimPayload, IInferenceConfig, ITelemetryPayload, TelemetryCallback } from '../domain/types';
import { PromptFormatter } from '../infrastructure/prompt-formatter';
import { OllamaClient } from '../ollamaClient';

export interface IGenerationResult {
    readonly text: string;
    readonly cancelled: boolean;
    readonly telemetry: ITelemetryPayload;
}

export class InferenceAgent {
    private abortController: AbortController | null = null;
    private currentRequestId: number = 0;
    private ollamaClient: OllamaClient;
    private promptFormatter: PromptFormatter;
    private telemetryCallback: TelemetryCallback | undefined = undefined;

    constructor(ollamaClient: OllamaClient, telemetryCallback?: TelemetryCallback) {
        this.ollamaClient = ollamaClient;
        this.promptFormatter = new PromptFormatter();
        this.telemetryCallback = telemetryCallback;
    }

    cancel(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    async executeInference(
        payload: IFimPayload,
        config: IInferenceConfig,
        documentVersion: number,
        cancellationToken: vscode.CancellationToken | undefined,
        syntheticStopSignal: AbortSignal | undefined,
        onToken?: (token: string) => void,
    ): Promise<IGenerationResult> {
        const requestId = ++this.currentRequestId;
        const startTime = Date.now();

        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();
        const versionSignal = this.abortController.signal;

        const signals: AbortSignal[] = [versionSignal];
        if (syntheticStopSignal) {
            signals.push(syntheticStopSignal);
        }

        let combinedSignal: AbortSignal;
        if (signals.length === 1) {
            combinedSignal = signals[0];
        } else {
            combinedSignal = AbortSignal.any(signals);
        }

        if (combinedSignal.aborted || (cancellationToken?.isCancellationRequested ?? false)) {
            return this.buildCancelledResult(startTime, documentVersion, 'cancelled_before_start');
        }

        const prompt = this.promptFormatter.formatFimPrompt(payload);
        const requestBody = this.promptFormatter.buildRequestBody(payload, config);
        const accumulatedTokens: string[] = [];
        let accumulatedText = '';
        let cancelled = false;
        let abortReason: string | undefined = undefined;
        let finished = false;

        const onDoneInternal = () => {
            finished = true;
        };

        const onTokenInternal = (token: string) => {
            if (combinedSignal.aborted || this.currentRequestId !== requestId) {
                cancelled = true;
                abortReason = 'cancelled';
                return;
            }

            if (cancellationToken?.isCancellationRequested ?? false) {
                cancelled = true;
                abortReason = 'cancelled';
                return;
            }

            accumulatedTokens.push(token);
            accumulatedText += token;

            if (onToken) {
                onToken(token);
            }
        };

        try {
            await this.ollamaClient.streamGenerate(
                prompt,
                requestBody,
                onTokenInternal,
                onDoneInternal,
                combinedSignal,
            );
        } catch (error: unknown) {
            if (error instanceof Error && error.message === 'AbortError') {
                cancelled = true;
                if (!abortReason) { abortReason = 'cancelled'; }
            } else {
                const errMsg = error instanceof Error ? error.message : String(error);
                console.error('InferenceAgent: generation failed:', errMsg);
                cancelled = true;
                abortReason = 'error';
            }
        }

        if (this.currentRequestId !== requestId) {
            return this.buildCancelledResult(startTime, documentVersion, 'superseded');
        }

        const elapsed = Date.now() - startTime;
        const telemetry: ITelemetryPayload = {
            timestamp: startTime,
            latencyMs: elapsed,
            language: '',
            documentVersion,
            truncated: abortReason === 'max_tokens',
            tokenCount: accumulatedTokens.length,
            error: abortReason === 'error',
            abortReason: cancelled ? abortReason : undefined,
        };

        if (this.telemetryCallback) {
            this.telemetryCallback(telemetry);
        }

        return {
            text: accumulatedText,
            cancelled: cancelled && abortReason !== 'superseded',
            telemetry,
        };
    }

    private buildCancelledResult(startTime: number, documentVersion: number, reason: string): IGenerationResult {
        const elapsed = Date.now() - startTime;
        return {
            text: '',
            cancelled: true,
            telemetry: {
                timestamp: startTime,
                latencyMs: elapsed,
                language: '',
                documentVersion,
                truncated: false,
                tokenCount: 0,
                error: reason === 'error',
                abortReason: reason,
            },
        };
    }
}

export default InferenceAgent;
