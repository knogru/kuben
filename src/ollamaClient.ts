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
  constructor(
    private endpoint: string = 'http://localhost:11434',
    private model: string = 'qwen2.5-coder'
  ) {}

  async generate(prompt: string): Promise<string | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000);

    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: false,
        } as OllamaRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.error(`Ollama error: ${response.status}`);
        return undefined;
      }

      const data: OllamaResponse = await response.json();
      return data.response;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.error('Ollama connection failed: Request timeout (30s)');
        } else {
          console.error('Ollama connection failed:', error.message);
        }
      } else {
        console.error('Ollama connection failed:', error);
      }
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}
