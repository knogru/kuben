import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import * as readline from 'readline';
import { URL } from 'url';
import { FimPromptContext } from './contextManager';

export interface OllamaResponseChunk {
    model: string;
    created_at: string;
    response: string; // O token gerado neste chunk
    done: boolean;
}

export interface OllamaInferenceOptions {
    num_predict?: number;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
}

export class OllamaClient {
    private static instance: OllamaClient | null = null;
    private endpoint: string;
    private model: string;

    public static getInstance(): OllamaClient {
        if (!OllamaClient.instance) {
            OllamaClient.instance = new OllamaClient();
        }
        return OllamaClient.instance;
    }

    constructor() {
        const config = vscode.workspace.getConfiguration('kuben');
        this.endpoint = config.get<string>('ollamaUrl', 'http://localhost:11434');
        this.model = config.get<string>('modelName', 'deepseek-coder:1.3b');
    }

    /**
     * Efetua a requisição FIM via HTTP Stream e invoca o callback token por token.
     * Retorna uma Promise que resolve ao finalizar o stream (done: true).
     */
    public async generateWithFIMStream(
        context: FimPromptContext,
        onToken: (token: string) => void,
        token: vscode.CancellationToken
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            if (token.isCancellationRequested) {
                return reject(new Error('Cancellation requested before request started.'));
            }

            const config = vscode.workspace.getConfiguration('kuben');
            this.endpoint = config.get<string>('ollamaUrl', 'http://localhost:11434');
            this.model = config.get<string>('modelName', 'deepseek-coder:1.3b');

            const url = new URL(`${this.endpoint}/api/generate`);
            
            // Payload cru estruturado para FIM (Fill-in-the-Middle)
            const defaultOptions: OllamaInferenceOptions = {
                num_predict: 64,
                temperature: 0.2,
                top_p: 0.95
            };

            const options = {
                ...defaultOptions,
                ...(context.options || {})
            };

            const postData = JSON.stringify({
                model: this.model,
                prompt: context.prompt,
                suffix: context.suffix,
                stream: true, // Crucial para F04b
                options
            });

            const requestOptions: http.RequestOptions = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const clientModule = url.protocol === 'https:' ? https : http;

            const req = clientModule.request(requestOptions, (res) => {
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    return reject(new Error(`Ollama returned status code ${res.statusCode}`));
                }

                // Configura interface de leitura linha por linha sobre o stream HTTP
                const rl = readline.createInterface({
                    input: res,
                    terminal: false
                });

                // Evento disparado assim que uma nova linha (NDJSON) é despejada no buffer
                rl.on('line', (line) => {
                    if (token.isCancellationRequested) {
                        req.destroy();
                        rl.close();
                        return reject(new Error('Cancellation requested during streaming.'));
                    }

                    if (!line.trim()) return;

                    try {
                        const chunk: OllamaResponseChunk = JSON.parse(line);
                        
                        if (chunk.response) {
                            onToken(chunk.response); // Despacha o token imediatamente para o editor UI
                        }

                        if (chunk.done) {
                            rl.close();
                        }
                    } catch (e) {
                        // Silencia ou loga falhas parciais de parsing sem derrubar a extensão
                        console.error('[Kuben Inference] Failed to parse stream chunk:', e);
                    }
                });

                rl.on('close', () => {
                    resolve();
                });

                res.on('error', (err) => {
                    reject(err);
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            // Aborta a requisição HTTP imediatamente caso o usuário continue digitando
            token.onCancellationRequested(() => {
                req.destroy();
                resolve(); 
            });

            req.write(postData);
            req.end();
        });
    }

    public async checkConnection(): Promise<boolean> {
        try {
            const config = vscode.workspace.getConfiguration('kuben');
            this.endpoint = config.get<string>('ollamaUrl', 'http://localhost:11434');
            const response = await fetch(`${this.endpoint}/api/models`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            return response.ok;
        } catch (err) {
            console.warn('[Kuben] checkConnection failed:', err);
            return false;
        }
    }
}