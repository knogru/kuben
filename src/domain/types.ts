export interface IFimPayload {
    readonly prefix: string;
    readonly suffix: string;
    readonly isSpmFormat: boolean;
}

export interface ISyntaxBounds {
    readonly blockType: string;
    readonly hasValidScope: boolean;
    readonly startLine: number;
    readonly endLine: number;
    readonly isInsideFunction: boolean;
    readonly isInsideClass: boolean;
    readonly isInsideBlock: boolean;
    readonly braceStack: string[];
}

export interface IInferenceConfig {
    readonly model: string;
    readonly endpoint: string;
    readonly numPredict: number;
    readonly temperature: number;
    readonly topP: number | undefined;
    readonly numCtx: number;
    readonly raw: boolean;
    readonly stream: boolean;
}

export interface ITelemetryPayload {
    readonly timestamp: number;
    readonly latencyMs: number;
    readonly language: string;
    readonly documentVersion: number;
    readonly truncated: boolean;
    readonly tokenCount: number;
    readonly error: boolean;
    readonly abortReason: string | undefined;
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
