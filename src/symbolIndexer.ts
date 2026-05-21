import * as vscode from 'vscode';

export type SymbolLocation = { name: string; uri: vscode.Uri; range: vscode.Range };

export class SymbolIndexer {
  private index: Map<string, SymbolLocation[]> = new Map();

  async indexDocument(document: vscode.TextDocument) {
    try {
      const symbols = (await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri)) as vscode.DocumentSymbol[] | undefined;
      if (!symbols) return;

      const locations: SymbolLocation[] = [];
      const walk = (symList: vscode.DocumentSymbol[]) => {
        for (const s of symList) {
          locations.push({ name: s.name, uri: document.uri, range: s.range });
          if (s.children && s.children.length) walk(s.children);
        }
      };
      walk(symbols);

      this.index.set(document.uri.toString(), locations);
    } catch (e) {
      console.error('SymbolIndexer: failed to index document', e);
    }
  }

  getSymbolsForUri(uri: vscode.Uri): SymbolLocation[] {
    return this.index.get(uri.toString()) || [];
  }

  clear() {
    this.index.clear();
  }
}

export default SymbolIndexer;
