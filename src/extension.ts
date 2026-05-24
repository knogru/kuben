
import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';
import { ContextManager } from './contextManager';
import { ASTManager } from './astManager';
import { ContextAgent } from './agents/context-agent';
import { ActiveTruncator } from './application/active-truncator';
import { InferenceAgent } from './application/inference-agent';
import { IncrementalPostProcessor } from './infrastructure/incremental-post-processor';
import { IFimPayload, IInferenceConfig, ITelemetryPayload, DEFAULT_INFERENCE_CONFIG } from './domain/types';
import { ITruncationResult } from './domain/truncation-types';

export async function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('kuben');
    let enabled = config.get<boolean>('enabled', true);
    const endpoint = config.get<string>('endpoint', 'http://localhost:11434');
    const model = config.get<string>('model', 'qwen2.5-coder:1.5b');
    let debounceDelay = config.get<number>('debounceDelay', 75);
    let contextWindow = config.get<number>('contextWindow', 30);
    let useASTEngine = config.get<boolean>('useASTEngine', true);

    const ollamaClient = new OllamaClient(endpoint, model);

    const astManager = await ASTManager.create(useASTEngine);

    for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === 'file') {
            await astManager.indexDocument(doc);
        }
    }

    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme === 'file') { astManager.indexDocument(doc); }
    });

    const openListener = vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.uri.scheme === 'file') { astManager.indexDocument(doc); }
    });

    context.subscriptions.push(saveListener, openListener);

    let enableGraphRag = config.get<boolean>('enableGraphRag', true);
    let telemetryEnabled = config.get<boolean>('telemetry.enabled', true);
    let telemetryOptIn = config.get<boolean>('telemetry.optIn', false);

    if (!telemetryOptIn && telemetryEnabled) {
        vscode.window.showInformationMessage(
            'Kuben can collect code snippets to fine-tune local models. No data is sent externally. See settings for privacy controls.',
            'Learn More', 'Dismiss'
        ).then((choice) => {
            if (choice === 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/knogru/kuben'));
            }
        });
    }

    const latencySamples: number[] = [];

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'kuben.cancel';
    statusBar.tooltip = 'Click to cancel Kuben generation';
    context.subscriptions.push(statusBar);

    const contextManager = new ContextManager(astManager);
    const contextAgent = new ContextAgent(astManager);
    const activeTruncator = new ActiveTruncator();
    const postProcessor = new IncrementalPostProcessor();

    const telemetryCallback = (payload: ITelemetryPayload) => {
        if (telemetryEnabled) {
            latencySamples.push(payload.latencyMs);
            console.debug(`Kuben: FIM roundtrip ${payload.latencyMs}ms, tokens: ${payload.tokenCount}, reason: ${payload.abortReason ?? 'ok'}`);
        }
    };

    const inferenceAgent = new InferenceAgent(ollamaClient, telemetryCallback);

    function createDebounced<T extends any[], R>(
        fn: (...args: T) => Promise<R>,
        delay: number
    ) {
        let timeout: NodeJS.Timeout | null = null;
        let pendingResolve: ((value: R | undefined) => void) | null = null;

        return (...args: T): Promise<R | undefined> => {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
                if (pendingResolve) {
                    pendingResolve(undefined);
                    pendingResolve = null;
                }
            }

            return new Promise((resolve) => {
                pendingResolve = resolve;
                timeout = setTimeout(async () => {
                    try {
                        const result = await fn(...args);
                        resolve(result as R | undefined);
                    } catch (e) {
                        console.error('Debounced function error:', e);
                        resolve(undefined);
                    } finally {
                        pendingResolve = null;
                        timeout = null;
                    }
                }, delay);
            });
        };
    }

    const debouncedGenerate = createDebounced(
        async (
            document: vscode.TextDocument,
            position: vscode.Position,
            token: vscode.CancellationToken,
        ): Promise<string | undefined> => {
            if (!enabled || token.isCancellationRequested) {
                return undefined;
            }

            const { prefix: rawPrefix, suffix: rawSuffix } = await contextManager.buildPrefixSuffix(
                document, position, contextWindow,
            );

            if (token.isCancellationRequested) {
                return undefined;
            }

            const bounds = await contextAgent.getSyntaxBounds(document, position);

            const payload: IFimPayload = {
                prefix: rawPrefix,
                suffix: rawSuffix,
                isSpmFormat: false,
            };

            const blockType = bounds?.blockType ?? 'source_file';
            const truncationResult: ITruncationResult = activeTruncator.truncatePayload(
                payload,
                blockType,
            );

            const referenceSuffix = truncationResult.truncatedPayload.suffix;

            const inferenceConfig: IInferenceConfig = {
                ...DEFAULT_INFERENCE_CONFIG,
                endpoint: endpoint,
                model: model,
            };

            statusBar.text = '$(sync~spin) Kuben: Generating';
            statusBar.show();

            let accumulatedCompletion = '';
            const streamAbortController = new AbortController();

            const generationResult = await inferenceAgent.executeInference(
                truncationResult.truncatedPayload,
                inferenceConfig,
                document.version,
                token,
                streamAbortController.signal,
                (chunk: string) => {
                    accumulatedCompletion += chunk;

                    const evaluation = postProcessor.evaluate(
                        accumulatedCompletion,
                        referenceSuffix,
                    );

                    if (evaluation.shouldStop) {
                        accumulatedCompletion = evaluation.cleanedText;
                        streamAbortController.abort();
                    }
                },
            );

            statusBar.hide();

            if (generationResult.cancelled || !accumulatedCompletion.trim()) {
                return undefined;
            }

            return accumulatedCompletion;
        },
        debounceDelay,
    );

    const provider = vscode.languages.registerInlineCompletionItemProvider(
        [{ language: 'javascript' }, { language: 'typescript' }],
        {
            async provideInlineCompletionItems(document, position, context, token) {
                if (!enabled) { return []; }

                try {
                    statusBar.text = '$(sync~spin) Kuben: Generating';
                    statusBar.show();
                    const completion = await debouncedGenerate(document, position, token);
                    if (completion && completion.trim()) {
                        return [new vscode.InlineCompletionItem(completion)];
                    }
                } catch (err) {
                    console.error('Error while requesting completion:', err);
                } finally {
                    statusBar.hide();
                }

                return [];
            },
        },
    );

    context.subscriptions.push(provider);

    const toggleCmd = vscode.commands.registerCommand('kuben.toggle', async () => {
        enabled = !enabled;
        await config.update('enabled', enabled, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Kuben autocomplete ${enabled ? 'enabled' : 'disabled'}`);
    });

    context.subscriptions.push(toggleCmd);

    const cancelCmd = vscode.commands.registerCommand('kuben.cancel', () => {
        try {
            inferenceAgent.cancel();
            statusBar.hide();
            vscode.window.showInformationMessage('Kuben generation cancelled');
        } catch (e) {
            // ignore
        }
    });

    context.subscriptions.push(cancelCmd);

    const cfgListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('kuben.debounceDelay') || e.affectsConfiguration('kuben.model') || e.affectsConfiguration('kuben.endpoint') || e.affectsConfiguration('kuben.contextWindow')) {
            const newCfg = vscode.workspace.getConfiguration('kuben');
            debounceDelay = newCfg.get<number>('debounceDelay', debounceDelay);
            contextWindow = newCfg.get<number>('contextWindow', contextWindow);
        }
    });

    context.subscriptions.push(cfgListener);

    const showLatencyCmd = vscode.commands.registerCommand('kuben.showLatency', async () => {
        if (latencySamples.length === 0) {
            vscode.window.showInformationMessage('Kuben: no latency samples collected yet');
            return;
        }
        const sum = latencySamples.reduce((a, b) => a + b, 0);
        const avg = Math.round(sum / latencySamples.length);
        const max = Math.max(...latencySamples);
        const min = Math.min(...latencySamples);
        vscode.window.showInformationMessage(`Kuben latency samples — avg ${avg}ms (n=${latencySamples.length}), min ${min}ms, max ${max}ms`);
    });

    context.subscriptions.push(showLatencyCmd);

    const telemetryCmd = vscode.commands.registerCommand('kuben.manageTelemetry', async () => {
        const choice = await vscode.window.showQuickPick(
            [
                { label: 'View Latency Stats', description: 'Show collected latency samples' },
                { label: 'Toggle Telemetry', description: 'Enable/disable latency collection' },
                { label: 'Toggle Dataset Opt-In', description: 'Enable/disable code snippet collection for fine-tuning' }
            ],
            { placeHolder: 'Kuben Telemetry & Privacy' }
        );

        if (choice?.label === 'View Latency Stats') {
            if (latencySamples.length > 0) {
                const sum = latencySamples.reduce((a, b) => a + b, 0);
                const avg = Math.round(sum / latencySamples.length);
                const max = Math.max(...latencySamples);
                const min = Math.min(...latencySamples);
                vscode.window.showInformationMessage(`Kuben latency — avg ${avg}ms (n=${latencySamples.length}), min ${min}ms, max ${max}ms`);
            } else {
                vscode.window.showInformationMessage('Kuben: no latency samples collected yet');
            }
        } else if (choice?.label === 'Toggle Telemetry') {
            telemetryEnabled = !telemetryEnabled;
            await config.update('telemetry.enabled', telemetryEnabled, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Kuben latency telemetry ${telemetryEnabled ? 'enabled' : 'disabled'}`);
        } else if (choice?.label === 'Toggle Dataset Opt-In') {
            telemetryOptIn = !telemetryOptIn;
            await config.update('telemetry.optIn', telemetryOptIn, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Kuben dataset opt-in ${telemetryOptIn ? 'enabled (collection will begin on next session)' : 'disabled'}`);
        }
    });

    context.subscriptions.push(telemetryCmd);
}

export function deactivate() {}