import * as http from 'http';
import * as vscode from 'vscode';
import { FIMContext } from './contextManager';

export class OllamaClient {
  private static instance: OllamaClient | null = null;
  private endpoint: string;
  private model: string;

  private constructor() {
    const config = vscode.workspace.getConfiguration('kuben');
    this.endpoint = config.get<string>('ollamaEndpoint', 'http://localhost:11434');
    this.model = config.get<string>('modelName', 'qwen2.5-coder:1.5b');
  }

  public static getInstance(): OllamaClient {
    if (!OllamaClient.instance) {
      OllamaClient.instance = new OllamaClient();
    }
    return OllamaClient.instance;
  }

  /**
   * Realiza a inferência FIM via streaming incremental diretamente do Ollama local.
   * Suporta cancelamento precoce via CancellationToken do VS Code.
   */
  public async generateInlineCompletion(
    context: FIMContext,
    token: vscode.CancellationToken
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.endpoint}/api/generate`);
      
      const payload = JSON.stringify({
        model: this.model,
        prompt: context.prompt,
        stream: true,
        options: {
          num_predict: 64,       // Limita a geração para respostas curtas de autocompletar
          temperature: 0.0,      // Ganho de determinismo e velocidade
          top_p: 0.9,
          stop: ["<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>", "\n\n"] // Critérios de parada física
        }
      });

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      let fullResponse = '';
      let buffer = '';

      const req = http.request(options, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama retornou status HTTP ${res.statusCode}`));
          return;
        }

        res.setEncoding('utf8');

        // Escuta os pacotes de rede brutos (TCP chunks)
        res.on('data', (chunk) => {
          if (token.isCancellationRequested) {
            req.destroy(); // Fecha a conexão de rede imediatamente se o usuário digitar algo
            resolve(fullResponse);
            return;
          }

          buffer += chunk;
          let lineIndex: number;

          // Processa buffer incremental linha por linha (NDJSON)
          while ((lineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.substring(0, lineIndex).trim();
            buffer = buffer.substring(lineIndex + 1);

            if (line) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.response) {
                  fullResponse += parsed.response;
                  
                  // Otimização de Resposta Curta: Se já temos linhas válidas completas e o modelo começa a divagar, podemos cortar antecipadamente
                  if (fullResponse.includes('\n') && fullResponse.trim().length > 0) {
                    // Opcional: Interromper stream aqui caso a primeira linha completa já baste
                  }
                }
              } catch (e) {
                // Ignora JSONs malformados por estarem truncados na borda do chunk de rede
              }
            }
          }
        });

        res.on('end', () => {
          resolve(fullResponse);
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      // Vincula o mecanismo de cancelamento do VS Code diretamente ao ciclo de vida da requisição HTTP
      token.onCancellationRequested(() => {
        req.destroy();
        resolve(fullResponse);
      });

      req.write(payload);
      req.end();
    });
  }
}