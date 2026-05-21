# kuben README

This is the README for your extension "kuben". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

This extension integrates with a local Ollama server to provide FIM-based inline code completions.

Prerequisites:

- Node.js 18+ and npm
- A running Ollama server (default: `http://localhost:11434`) with at least one code model installed (recommended: `qwen2.5-coder:1.5b` or `codegemma:2b-code`).

Install Ollama and a model locally before using the extension. Example:

```bash
# install and run ollama (see https://ollama.com/docs)
ollama run qwen2.5-coder:1.5b
```

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

Currently the extension uses sensible defaults but settings will be added to configure:

- Ollama endpoint URL
- Model selection
- Debounce delay and context window size

(These settings will be contributed via `contributes.configuration` in `package.json`.)

## Known Issues

- Models smaller than ~1.5–2B may produce prose or ignore the FIM format; the extension filters responses but results vary by model.
- The test runner (`npm test`) uses the VS Code test runner and requires a proper VS Code test environment.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Quick Start (development)

1. Install dependencies and build:

```bash
cd kuben
npm install
npm run compile
```

2. Run the extension in the Extension Development Host (press `F5` in VS Code).

3. Run tests (note: uses VS Code test runner):

```bash
npm test
```

4. Manual validation of Ollama:

```bash
curl -X POST http://localhost:11434/api/generate \
	-H "Content-Type: application/json" \
	-d '{"model":"qwen2.5-coder:1.5b","prompt":"<|fim_prefix|>function foo() {\n  <|fim_suffix|>\n}<|fim_middle|>","stream":false,"num_predict":20}'
```

If the model endpoint returns JSON with a `response` field, the extension should be able to consume it.

## Where tests were added

Unit tests for `OllamaClient` are in `src/test/extension.test.ts` and mock the network layer to run offline.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
