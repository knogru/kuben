const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * @type {import('esbuild').Plugin}
 */
const wasmCopyPlugin = {
	name: 'wasm-copy',
	setup(build) {
		build.onEnd(() => {
			const wasmFiles = [
				'src/tree-sitter.wasm',
				'src/tree-sitter-javascript.wasm',
			];
			for (const src of wasmFiles) {
				const dest = path.join('dist', path.basename(src));
				if (fs.existsSync(src)) {
					fs.copyFileSync(src, dest);
					console.log(`[wasm-copy] Copied ${src} → ${dest}`);
				} else {
					console.warn(`[wasm-copy] Missing: ${src}`);
				}
			}
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode', '*.wasm'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
			wasmCopyPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
