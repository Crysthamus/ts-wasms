import { fileURLToPath } from "node:url";

/**
 * Resolves the absolute path to a specific language's WASM file.
 *
 * @param {string} lang
 * @returns {string}
 */
export function getWasmPath(lang) {
	const url = new URL(
		`./out/${lang}/tree-sitter-${lang}.wasm`,
		import.meta.url,
	);
	return fileURLToPath(url);
}

/**
 * Resolves the absolute path to a specific language's query file.
 *
 * @param {string} lang
 * @param {string} query
 * @returns {string}
 */
export function getQueryPath(lang, query) {
	const url = new URL(`./out/${lang}/${query}.scm`, import.meta.url);
	return fileURLToPath(url);
}
