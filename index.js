import fs from "node:fs";
import { fileURLToPath } from "node:url";

const manifestUrl = new URL("./manifest.json", import.meta.url);
const manifest = JSON.parse(
	fs.readFileSync(fileURLToPath(manifestUrl), "utf8"),
);

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

/**
 * Returns an object mapping available query types to their absolute file paths.
 *
 * @param {string} lang
 * @returns {Record<string, string>}
 */
export function getAvailableQueries(lang) {
	const queries = manifest[lang] || [];
	const result = {};
	for (const query of queries) {
		result[query] = getQueryPath(lang, query);
	}
	return result;
}
