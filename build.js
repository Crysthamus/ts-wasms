import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import pMap from "p-map";

const execAsync = promisify(exec);
const OUT_DIR = path.resolve("out");
const CACHE_FILE = path.resolve(".build-state.json");
const FORCE_REBUILD = process.env.FORCE_REBUILD === "true";

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"test",
	"tests",
	"examples",
	"fixtures",
	"vendor",
	"target",
	"build",
	"docs",
]);

const LANG_NAME_MAP = {
	"hcl-terraform": "terraform",
	"xml-dtd": "dtd",
	"typescript-tsx": "tsx",
	"csv-psv": "psv",
	"csv-tsv": "tsv",
};

const SCM_FILES = [
	"highlights.scm",
	"injections.scm",
	"locals.scm",
	"tags.scm",
	"folds.scm",
	"indents.scm",
];

/**
 * Derives the canonical language name based on the base package name and target name.
 */
function getLanguageName(baseName, targetName) {
	const normBase = baseName.replace(/_/g, "-");
	const normTarget = targetName.replace(/_/g, "-");

	const rawName =
		normTarget.startsWith(normBase) || normTarget === normBase
			? normTarget
			: `${normBase}-${normTarget}`;

	const mappedName = LANG_NAME_MAP[rawName] || rawName;
	return mappedName.replace(/-/g, "_");
}

/**
 * Validates if a dependency's generated assets exist and match the cached root version.
 */
async function validateCache(dep, requestedVersion, cache) {
	if (FORCE_REBUILD || !cache[dep] || cache[dep].version !== requestedVersion) {
		return false;
	}

	for (const lang of cache[dep].languages || []) {
		try {
			await fs.access(path.join(OUT_DIR, lang, `tree-sitter-${lang}.wasm`));
		} catch {
			return false;
		}
	}

	return true;
}

/**
 * Recursively searches a directory for folders containing 'grammar.js'
 * OR pre-generated tree-sitter C files marked by 'src/grammar.json'.
 */
async function findGrammarDirs(dir) {
	const results = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });

		const hasGrammarJs = entries.some(
			(e) => e.isFile() && e.name === "grammar.js",
		);
		const hasSrcDir = entries.some((e) => e.isDirectory() && e.name === "src");
		let hasGrammarJson = false;

		if (hasSrcDir) {
			try {
				const srcEntries = await fs.readdir(path.join(dir, "src"), {
					withFileTypes: true,
				});
				hasGrammarJson = srcEntries.some(
					(e) => e.isFile() && e.name === "grammar.json",
				);
			} catch (err) {
				if (err.code !== "ENOENT") throw err;
			}
		}

		if (hasGrammarJs || hasGrammarJson) {
			results.push(dir);
		}

		for (const entry of entries) {
			if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
				results.push(...(await findGrammarDirs(path.join(dir, entry.name))));
			}
		}
	} catch (err) {
		if (err.code !== "ENOENT")
			console.error(`Error scanning directories in ${dir}:`, err);
	}
	return results;
}

/**
 * Scans a dependency directory for prebuilt WASM files.
 */
async function findPrebuiltWasms(depPath) {
	try {
		const entries = await fs.readdir(depPath, { withFileTypes: true });
		return entries
			.filter(
				(e) =>
					e.isFile() &&
					e.name.endsWith(".wasm") &&
					e.name.startsWith("tree-sitter-"),
			)
			.map((e) => e.name);
	} catch (err) {
		if (err.code !== "ENOENT") console.error(`Error reading ${depPath}:`, err);
		return [];
	}
}

/**
 * Copies .scm query files.
 */
async function copyScmFiles(grammarDir, targetDir, depPath) {
	const dirsToCheck = [path.join(grammarDir, "queries"), grammarDir];

	if (depPath && depPath !== grammarDir) {
		dirsToCheck.push(path.join(depPath, "queries"), depPath);
	}

	for (const dir of dirsToCheck) {
		try {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isFile() && entry.name.endsWith(".scm")) {
					const srcPath = path.join(dir, entry.name);
					const destPath = path.join(targetDir, entry.name);

					try {
						await fs.copyFile(srcPath, destPath, fs.constants.COPYFILE_EXCL);
					} catch (err) {
						if (err.code !== "EEXIST")
							console.error(`Failed to copy ${entry.name}:`, err);
					}
				}
			}
		} catch (err) {
			if (err.code !== "ENOENT")
				console.error(`Error processing SCM files in ${dir}:`, err);
		}
	}
}

/**
 * Concurrently fetches missing .scm files from nvim-treesitter.
 */
async function fetchMissingQueries(langName, targetDir) {
	await pMap(
		SCM_FILES,
		async (scmFile) => {
			const destPath = path.join(targetDir, scmFile);

			try {
				await fs.access(destPath);
				return;
			} catch (err) {
				if (err.code !== "ENOENT") throw err;
			}

			const url = `https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/main/runtime/queries/${langName}/${scmFile}`;

			try {
				const response = await fetch(url);
				if (response.ok) {
					const text = await response.text();
					await fs.writeFile(destPath, text);
				} else if (response.status !== 404) {
					console.warn(
						`Failed to download ${scmFile} for ${langName}: HTTP ${response.status}`,
					);
				}
			} catch (error) {
				console.warn(
					`Network error fetching ${scmFile} for ${langName}: ${error.message}`,
				);
			}
		},
		{ concurrency: 3 },
	);
}

/**
 * Generates the manifest.json file detailing actual scm queries present for each language.
 */
async function generateManifest(languages) {
	const manifest = {};
	const sortedLangs = Array.from(languages).sort();

	for (const lang of sortedLangs) {
		const langOutDir = path.join(OUT_DIR, lang);
		try {
			const entries = await fs.readdir(langOutDir, { withFileTypes: true });
			manifest[lang] = entries
				.filter((e) => e.isFile() && e.name.endsWith(".scm"))
				.map((e) => e.name.replace(/\.scm$/, ""))
				.sort();
		} catch (err) {
			if (err.code !== "ENOENT")
				console.error(`Failed to read queries for ${lang}:`, err);
			manifest[lang] = [];
		}
	}

	await fs.writeFile(
		path.resolve("manifest.json"),
		JSON.stringify(manifest, null, 4),
		"utf8",
	);
	console.log("Generated manifest.json.");
	return manifest;
}

/**
 * Generates the index.d.ts file based on successfully processed languages.
 */
async function generateDeclarationFile(manifest) {
	let content = `/** Standard Tree-sitter query categories mapped per language */\nexport type QueryMap = {\n`;

	for (const [lang, queries] of Object.entries(manifest)) {
		const queryUnion =
			queries.length > 0 ? queries.map((q) => `"${q}"`).join(" | ") : "never";
		content += `    "${lang}": ${queryUnion};\n`;
	}

	content += `};\n
/** Supported language identifiers compiled during build step */
export type SupportedLanguage = keyof QueryMap;

/** Resolves the absolute path to a specific language's WASM file. */
export declare function getWasmPath(lang: SupportedLanguage): string;

/** Resolves the absolute path to a specific language's query file. */
export declare function getQueryPath<L extends SupportedLanguage>(lang: L, query: QueryMap[L]): string;

/** Returns an object mapping available query types to their absolute file paths. */
export declare function getAvailableQueries<L extends SupportedLanguage>(lang: L): Record<QueryMap[L], string>;\n`;

	await fs.writeFile(path.resolve("index.d.ts"), content, "utf8");
	console.log(
		`Generated index.d.ts with ${Object.keys(manifest).length} languages.`,
	);
}

/**
 * Processes a package relying on prebuilt WASM files.
 */
async function processPrebuiltWasm(wasmFiles, depPath, baseCleanName) {
	const built = [];
	for (const wasmFile of wasmFiles) {
		const cleanWasmName = wasmFile
			.replace(/\.wasm$/, "")
			.replace(/^tree-sitter-/, "");
		const langName = getLanguageName(baseCleanName, cleanWasmName);
		const langOutDir = path.join(OUT_DIR, langName);

		try {
			await fs.mkdir(langOutDir, { recursive: true });
			await fs.copyFile(
				path.join(depPath, wasmFile),
				path.join(langOutDir, `tree-sitter-${langName}.wasm`),
			);

			await copyScmFiles(depPath, langOutDir, depPath);
			await fetchMissingQueries(langName, langOutDir);

			built.push(langName);
			console.log(`Copied prebuilt WASM and queries for ${langName}`);
		} catch (error) {
			console.error(`Failed to process prebuilt WASM ${wasmFile}:`, error);
		}
	}
	return built;
}

/**
 * Compiles a Tree-sitter grammar from source into WASM.
 */
async function processSourceGrammar(grammarDirs, depPath, baseCleanName) {
	const built = [];
	for (const grammarDir of grammarDirs) {
		const cleanFolderName =
			grammarDir === depPath
				? baseCleanName
				: path.basename(grammarDir).replace(/^tree-sitter-/, "");

		const langName = getLanguageName(baseCleanName, cleanFolderName);
		const langOutDir = path.join(OUT_DIR, langName);

		try {
			await fs.mkdir(langOutDir, { recursive: true });
			await execAsync(`pnpm exec tree-sitter build --wasm "${grammarDir}"`, {
				cwd: langOutDir,
			});

			const outFiles = await fs.readdir(langOutDir);
			const generatedWasm = outFiles.find((f) => f.endsWith(".wasm"));

			if (generatedWasm && generatedWasm !== `tree-sitter-${langName}.wasm`) {
				await fs.rename(
					path.join(langOutDir, generatedWasm),
					path.join(langOutDir, `tree-sitter-${langName}.wasm`),
				);
			}

			await copyScmFiles(grammarDir, langOutDir, depPath);
			await fetchMissingQueries(langName, langOutDir);

			built.push(langName);
			console.log(`Compiled and copied queries for ${langName}`);
		} catch (error) {
			console.error(
				`Failed to compile grammar in ${grammarDir}: ${error.message.split("\n")[0]}`,
			);
		}
	}
	return built;
}

/**
 * Routes a dependency to either prebuilt copying or source compilation with caching.
 */
async function processDependency(dep, requestedVersion, cache) {
	const depPath = path.resolve("node_modules", dep);

	try {
		await fs.access(depPath);
	} catch {
		console.warn(`Directory missing for ${dep}. Did you run install?`);
		return [];
	}

	const isCached = await validateCache(dep, requestedVersion, cache);

	if (isCached) {
		return cache[dep].languages || [];
	}

	const baseCleanName = dep
		.replace(/^@[^/]+\//, "")
		.replace(/^tree-sitter-/, "");
	const prebuiltWasms = await findPrebuiltWasms(depPath);

	let builtLanguages = [];

	if (prebuiltWasms.length > 0) {
		builtLanguages = await processPrebuiltWasm(
			prebuiltWasms,
			depPath,
			baseCleanName,
		);
	} else {
		const grammarDirs = await findGrammarDirs(depPath);
		if (grammarDirs.length === 0) {
			console.warn(
				`No grammar.js or src/grammar.json found for ${dep}. Skipping.`,
			);
			return [];
		}
		builtLanguages = await processSourceGrammar(
			grammarDirs,
			depPath,
			baseCleanName,
		);
	}

	if (builtLanguages.length > 0) {
		cache[dep] = { version: requestedVersion, languages: builtLanguages };
	}

	return builtLanguages;
}

/**
 * Main application entry point.
 */
async function main() {
	if (FORCE_REBUILD) {
		console.log("FORCE_REBUILD enabled. Purging previous output...");
		await fs.rm(OUT_DIR, { recursive: true, force: true }).catch(() => {});
		await fs.rm(CACHE_FILE, { force: true }).catch(() => {});
	}

	await fs.mkdir(OUT_DIR, { recursive: true });

	let pkg;
	try {
		pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
	} catch (error) {
		console.error("Could not read or parse package.json.", error);
		process.exit(1);
	}

	let cache = {};
	if (!FORCE_REBUILD) {
		try {
			cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
		} catch {}
	}

	const allDeps = {
		...(pkg.devDependencies || {}),
	};
	const deps = Object.keys(allDeps).filter(
		(d) =>
			(d.includes("tree-sitter-") || d.endsWith("-tree-sitter")) &&
			d !== "tree-sitter-cli" &&
			d !== "web-tree-sitter",
	);

	console.log(`Found ${deps.length} tree-sitter dependencies to check.`);

	const nestedLanguages = await pMap(
		deps,
		(dep) => processDependency(dep, allDeps[dep], cache),
		{ concurrency: 3 },
	);

	const successfulLanguages = new Set(nestedLanguages.flat());

	await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 4), "utf8");

	const manifest = await generateManifest(successfulLanguages);
	await generateDeclarationFile(manifest);

	console.log("Build process completed.");
}

main().catch((err) => {
	console.error(`Application crash:`, err);
	process.exit(1);
});
