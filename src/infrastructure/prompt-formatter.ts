import { IFimPayload, IInferenceConfig } from '../domain/types';

export class PromptFormatter {

    formatFimPrompt(payload: IFimPayload): string {
        if (payload.isSpmFormat) {
            return `<|fim_prefix|>${payload.suffix}<|fim_suffix|>${payload.prefix}<|fim_middle|>`;
        }
        return `<|fim_prefix|>${payload.prefix}<|fim_suffix|>${payload.suffix}<|fim_middle|>`;
    }

    buildRequestBody(payload: IFimPayload, config: IInferenceConfig): Record<string, unknown> {
        const prompt = this.formatFimPrompt(payload);
        const body: Record<string, unknown> = {
            model: config.model,
            prompt: prompt,
            stream: config.stream,
            num_predict: config.numPredict,
            temperature: config.temperature,
            num_ctx: config.numCtx,
            raw: config.raw,
        };
        if (config.topP !== undefined) {
            body.top_p = config.topP;
        }
        return body;
    }
}

export default PromptFormatter;
