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
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const controller = this.abortController;
    const timeoutMs = 60000;

    try {
      const start = Date.now();
      const res = await this.postJson(`${this.endpoint}/api/generate`, {
        model: this.model,
        prompt: prompt,
        stream: true,
        temperature: 0.0,
        num_ctx: 1024,
        raw: true,
      }, timeoutMs, controller.signal);
      const elapsed = Date.now() - start;
      console.debug(`OllamaClient.generate RTT: ${elapsed}ms`);

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
    maxTokens: number = 24
  ): Promise<string | undefined> {
    const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const controller = this.abortController;
    const timeoutMs = 60000;

    try {
      const start = Date.now();
      const res = await this.postJson(`${this.endpoint}/api/generate`, {
        model: this.model,
        prompt: prompt,
        stream: true,
        num_predict: maxTokens,
        temperature: 0.0,
        num_ctx: 1024,
        raw: true,
      }, timeoutMs, controller.signal);
      const elapsed = Date.now() - start;
      console.debug(`OllamaClient.generateWithFIM RTT: ${elapsed}ms`);

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

  async streamGenerate(
    prompt: string,
    body: Record<string, unknown>,
    onToken: (token: string) => void,
    onDone: () => void,
    signal: AbortSignal,
  ): Promise<void> {
    const timeoutMs = 60000;
    const requestBody = { ...body, model: this.model, prompt, stream: true };

    try {
      await this.postJsonStream(
        `${this.endpoint}/api/generate`,
        requestBody,
        timeoutMs,
        signal,
        (message) => {
          if (!message) {return;}
          if (typeof message === 'string') {
            onToken(message);
            return;
          }
          if (message.response) {
            onToken(message.response);
          }
          if (message.done) {
            onDone();
          }
        }
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'AbortError') {
          console.debug('OllamaClient.streamGenerate: aborted');
        } else {
          console.error('OllamaClient.streamGenerate failed:', error.message);
        }
      } else {
        console.error('OllamaClient.streamGenerate failed:', error);
      }
    }
  }

  private cleanCompletion(response: string): string | undefined {
    const lines = response.split('\n');
    
    const codeLines: string[] = [];
    let foundCode = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!foundCode && trimmed === ''){
        continue;
      }

      if (trimmed.startsWith('```')) {
        continue;
      }

      const isProse = /^[A-Z].*[.!?:]$/.test(trimmed);
      if (isProse && !foundCode) {
        continue;
      }

      foundCode = true;
      codeLines.push(line);

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

  async generateWithFIMStream(prefix: string, suffix: string, onToken: (token: string) => void, maxTokens: number = 24): Promise<void> {
    const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const controller = this.abortController;
    const timeoutMs = 60000;

    try {
      await this.postJsonStream(
        `${this.endpoint}/api/generate`,
        {
          model: this.model,
          prompt: prompt,
          stream: true,
          num_predict: maxTokens,
          temperature: 0.0,
          num_ctx: 1024,
          raw: true,
        },
        timeoutMs,
        controller.signal,
        (message) => {
          if (!message) {return;}
          if (typeof message === 'string') {
            onToken(message);
            return;
          }
          if (message.response) {
            onToken(message.response);
          }
        }
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'AbortError') {
          console.error('FIM streaming generation failed: Request timeout');
        } else {
          console.error('FIM streaming generation failed:', error.message);
        }
      } else {
        console.error('FIM streaming generation failed:', error);
      }
    }
  }

  private async postJsonStream(
    urlStr: string,
    bodyObj: any,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    onMessage: (message: any) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
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
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Ollama error: ${res.statusCode}`));
          }

          let finished = false;
          let buffer = '';
          const decoder = new TextDecoder();

          const flushBuffer = (isFinal = false) => {
            while (true) {
              const newlineIndex = buffer.indexOf('\n');
              if (newlineIndex === -1) {break;}

              const line = buffer.slice(0, newlineIndex).trim();
              buffer = buffer.slice(newlineIndex + 1);
              if (!line) {continue;}

              let payload = line;
              if (payload.startsWith('data:')) {
                payload = payload.slice(5).trim();
              }
              if (payload === '[DONE]') {
                if (!finished) {
                  finished = true;
                  resolve();
                }
                return;
              }

              try {
                const parsed = JSON.parse(payload);
                onMessage(parsed);
                if (parsed.done) {
                  if (!finished) {
                    finished = true;
                    resolve();
                  }
                  return;
                }
              } catch {
                if (payload) {
                  onMessage(payload);
                }
              }
            }

            if (isFinal && buffer.trim()) {
              try {
                const parsed = JSON.parse(buffer.trim());
                onMessage(parsed);
              } catch {
                onMessage(buffer.trim());
              }
              buffer = '';
            }
          };

          res.on('data', (chunk: any) => {
            buffer += decoder.decode(chunk, { stream: true });
            flushBuffer();
          });

          res.on('end', () => {
            if (!finished) {
              flushBuffer(true);
              finished = true;
              resolve();
            }
          });

          res.on('error', (err: any) => {
            if (!finished) {
              finished = true;
              reject(err);
            }
          });
        });

        req.on('error', (err: any) => {
          reject(err);
        });

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
