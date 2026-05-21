export interface OllamaRequest {
  model: string;
  prompt: string;
  stream: boolean;
}

export interface OllamaResponse {
  response: string;
  done: boolean;
}

export class OllamaClient {
  private abortController: AbortController | null = null;
  constructor(
    private endpoint: string = 'http://localhost:11434',
    private model: string = 'qwen2.5-coder:1.5b'
  ) {}

  async generate(prompt: string): Promise<string | undefined> {
    // create and track controller so callers can cancel
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const controller = this.abortController;
    const timeoutMs = 60000;

    try {
      const res = await this.postJson(`${this.endpoint}/api/generate`, {
        model: this.model,
        prompt: prompt,
        stream: false,
      }, timeoutMs, controller.signal);

      if (!res.ok) {
        console.error(`Ollama error: ${res.status}`);
        return undefined;
      }

      const data: OllamaResponse = await res.json();
      return data.response;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'AbortError') {
          console.error('Ollama connection failed: Request timeout');
        } else {
          console.error('Ollama connection failed:', error.message);
        }
      } else {
        console.error('Ollama connection failed:', error);
      }
      return undefined;
    }
  }

  async generateWithFIM(
    prefix: string,
    suffix: string,
    maxTokens: number = 20
  ): Promise<string | undefined> {
    const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
    // create and track controller so callers can cancel
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const controller = this.abortController;
    const timeoutMs = 60000;

    try {
      const res = await this.postJson(`${this.endpoint}/api/generate`, {
        model: this.model,
        prompt: prompt,
        stream: false,
        num_predict: maxTokens,
        temperature: 0.3,
        top_p: 0.9,
      }, timeoutMs, controller.signal);

      if (!res.ok) {
        console.error(`Ollama error: ${res.status}`);
        return undefined;
      }

      const data: OllamaResponse = await res.json();
      return this.cleanCompletion(data.response);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'AbortError') {
          console.error('FIM generation failed: Request timeout (30s)');
        } else {
          console.error('FIM generation failed:', error.message);
        }
      } else {
        console.error('FIM generation failed:', error);
      }
      return undefined;
    }
  }

  cancel() {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch (e) {
        // ignore
      }
      this.abortController = null;
    }
  }

  private cleanCompletion(response: string): string | undefined {
    const lines = response.split('\n');
    
    const codeLines: string[] = [];
    let foundCode = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Pular linhas em branco antes do código começar
      if (!foundCode && trimmed === ''){
        continue;
      }

      // Ignorar markdown code fences
      if (trimmed.startsWith('```')) {
        continue;
      }

      // Detectar se a linha parece prosa (começa com letra maiúscula e termina com ponto)
      const isProse = /^[A-Z].*[.!?:]$/.test(trimmed);
      if (isProse && !foundCode) {
        continue;
      }

      // A partir daqui é código
      foundCode = true;
      codeLines.push(line);

      // Parar após 5 linhas de código
      if (codeLines.length >= 5) {
        break;
      }
    }

    const result = codeLines.join('\n').trimEnd();
    return result || undefined;
}

  private async postJson(urlStr: string, bodyObj: any, timeoutMs: number, signal?: AbortSignal) {
    return new Promise<{ ok: boolean; status: number; json: () => Promise<any> }>((resolve, reject) => {
      try {
        const url = new URL(urlStr);
        const lib = url.protocol === 'https:' ? require('https') : require('http');
        const data = JSON.stringify(bodyObj);

        const options: any = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
          timeout: timeoutMs,
        };

        const req = lib.request(url, options, (res: any) => {
          const chunks: any[] = [];
          res.on('data', (c: any) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            try {
              const parsed = text ? JSON.parse(text) : undefined;
              resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => parsed });
            } catch (e) {
              reject(e);
            }
          });
        });

        req.on('error', (err: any) => reject(err));
        req.on('timeout', () => {
          req.destroy(new Error('AbortError'));
          reject(new Error('AbortError'));
        });

        if (signal) {
          if (signal.aborted) {
            req.destroy(new Error('AbortError'));
            return reject(new Error('AbortError'));
          }
          const onAbort = () => {
            req.destroy(new Error('AbortError'));
            reject(new Error('AbortError'));
          };
          signal.addEventListener('abort', onAbort);
        }

        req.write(data);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
