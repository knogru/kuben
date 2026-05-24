export interface IFimPayload {
    prefix: string;
    suffix: string;
    isSpmFormat: boolean;
}

export interface ISyntaxBounds {
    blockType: string;
    hasValidScope: boolean;
    startLine: number;
    endLine: number;
    isInsideFunction: boolean;
    isInsideClass: boolean;
    isInsideBlock: boolean;
    braceStack: string[];
}

export interface IInferenceConfig {
    model: string;
    endpoint: string;
    numPredict: number;
    temperature: number;
    topP: number | undefined;
    numCtx: number;
    raw: boolean;
    stream: boolean;
}

export interface ITelemetryPayload {
    timestamp: number;
    latencyMs: number;
    language: string;
    documentVersion: number;
    truncated: boolean;
    tokenCount: number;
    error: boolean;
    abortReason: string | undefined;
}

export interface TelemetryCallback {
    (payload: ITelemetryPayload): void;
}

export const DEFAULT_INFERENCE_CONFIG: IInferenceConfig = {
    model: 'qwen2.5-coder:1.5b',
    endpoint: 'http://localhost:11434',
    numPredict: 24,
    temperature: 0.0,
    topP: undefined,
    numCtx: 1024,
    raw: true,
    stream: true,
};
