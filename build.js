import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import pMap from "p-map";

const execAsync = promisify(exec);
const OUT_DIR = path.resolve("out");

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

const log = {
	info: (msg) => console.log(`[INFO] ${msg}`),
	debug: (msg) => console.log(`[DEBUG] ${msg}`),
	warn: (msg) => console.warn(`[WARN] ${msg}`),
	error: (msg) => console.error(`[ERROR] ${msg}`),
};

/**
 * Derives the canonical language name based on the base package name and target name.
 */
function getLanguageName(baseName, targetName) {
	const rawName =
		targetName.startsWith(baseName) || targetName === baseName
			? targetName
			: `${baseName}-${targetName}`;

	const mappedName = LANG_NAME_MAP[rawName] || rawName;
	return mappedName.replace(/-/g, "_");
}

/**
 * Recursively searches a directory for folders containing 'grammar.js'
 * OR pre-generated tree-sitter C files marked by 'src/grammar.json'.
 */
async function findGrammarDirs(dir) {
	const results = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		let hasGrammarJs = false;
		let hasSrcDir = false;

		for (const entry of entries) {
			if (entry.isFile() && entry.name === "grammar.js") hasGrammarJs = true;
			else if (entry.isDirectory() && entry.name === "src") hasSrcDir = true;
		}

		let hasGrammarJson = false;
		if (hasSrcDir) {
			try {
				const srcEntries = await fs.readdir(path.join(dir, "src"), {
					withFileTypes: true,
				});
				hasGrammarJson = srcEntries.some(
					(e) => e.isFile() && e.name === "grammar.json",
				);
			} catch (e) {}
		}

		if (hasGrammarJs || hasGrammarJson) {
			results.push(dir);
		}

		for (const entry of entries) {
			if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
				const subResults = await findGrammarDirs(path.join(dir, entry.name));
				results.push(...subResults);
			}
		}
	} catch (error) {}
	return results;
}

/**
 * Copies .scm query files from the grammar directory and the root dependency directory.
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
						await fs.access(destPath);
					} catch {
						await fs.copyFile(srcPath, destPath);
					}
				}
			}
		} catch (error) {}
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
			} catch {}

			const url = `https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/main/runtime/queries/${langName}/${scmFile}`;

			try {
				const response = await fetch(url);
				if (response.ok) {
					const text = await response.text();
					await fs.writeFile(destPath, text);
					log.debug(
						`Downloaded ${scmFile} for ${langName} from nvim-treesitter`,
					);
				} else if (response.status !== 404) {
					log.warn(
						`Failed to download ${scmFile} for ${langName}: HTTP ${response.status}`,
					);
				}
			} catch (error) {
				log.warn(
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
			const queries = entries
				.filter((e) => e.isFile() && e.name.endsWith(".scm"))
				.map((e) => e.name.replace(/\.scm$/, ""))
				.sort();
			manifest[lang] = queries;
		} catch (error) {
			manifest[lang] = [];
		}
	}

	await fs.writeFile(
		path.resolve("manifest.json"),
		JSON.stringify(manifest, null, 4),
		"utf8",
	);
	log.info("Generated manifest.json.");
	return manifest;
}

/**
 * Generates the index.d.ts file based on successfully processed languages.
 */
async function generateDeclarationFile(manifest) {
	let content = `/** Standard Tree-sitter query categories mapped per language */
export type QueryMap = {
`;

	for (const [lang, queries] of Object.entries(manifest)) {
		const queryUnion =
			queries.length > 0 ? queries.map((q) => `"${q}"`).join(" | ") : "never";
		content += `    "${lang}": ${queryUnion};\n`;
	}

	content += `};

/** Supported language identifiers compiled during build step */
export type SupportedLanguage = keyof QueryMap;

/** Resolves the absolute path to a specific language's WASM file. */
export declare function getWasmPath(lang: SupportedLanguage): string;

/** Resolves the absolute path to a specific language's query file. */
export declare function getQueryPath<L extends SupportedLanguage>(
    lang: L,
    query: QueryMap[L],
): string;

/** Returns an object mapping available query types to their absolute file paths. */
export declare function getAvailableQueries<L extends SupportedLanguage>(
    lang: L,
): Record<QueryMap[L], string>;
`;

	await fs.writeFile(path.resolve("index.d.ts"), content, "utf8");
	log.info(
		`Generated index.d.ts with ${Object.keys(manifest).length} languages.`,
	);
}

/**
 * Processes a package relying on prebuilt WASM files.
 */
async function processPrebuiltWasm(
	wasmFiles,
	depPath,
	baseCleanName,
	successfulLanguages,
) {
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

			successfulLanguages.add(langName);
			log.info(`Copied prebuilt WASM and queries for ${langName}`);
		} catch (error) {
			log.error(
				`Failed to process prebuilt WASM ${wasmFile}: ${error.message}`,
			);
		}
	}
}

/**
 * Compiles a Tree-sitter grammar from source into WASM.
 */
async function processSourceGrammar(
	grammarDirs,
	depPath,
	baseCleanName,
	successfulLanguages,
) {
	for (const grammarDir of grammarDirs) {
		const relativeName = path.relative(
			path.resolve("node_modules"),
			grammarDir,
		);
		const cleanFolderName =
			grammarDir === depPath
				? baseCleanName
				: path.basename(grammarDir).replace(/^tree-sitter-/, "");

		const langName = getLanguageName(baseCleanName, cleanFolderName);
		const langOutDir = path.join(OUT_DIR, langName);

		try {
			await fs.mkdir(langOutDir, { recursive: true });
			log.debug(`Building WASM for ${relativeName} into out/${langName}...`);

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

			successfulLanguages.add(langName);
			log.info(`Compiled and copied queries for ${langName}`);
		} catch (error) {
			log.error(
				`Failed to process ${relativeName}: ${error.message.split("\n")[0]}`,
			);
		}
	}
}

/**
 * Routes a dependency to either prebuilt copying or source compilation.
 */
async function processDependency(dep, successfulLanguages) {
	const depPath = path.resolve("node_modules", dep);

	try {
		await fs.access(depPath);
	} catch {
		log.warn(`Directory missing for ${dep}. Did you run install?`);
		return;
	}

	const baseCleanName = dep
		.replace(/^@[^/]+\//, "")
		.replace(/^tree-sitter-/, "");
	const prebuiltWasms = [];

	try {
		const entries = await fs.readdir(depPath, { withFileTypes: true });
		for (const entry of entries) {
			if (
				entry.isFile() &&
				entry.name.endsWith(".wasm") &&
				entry.name.startsWith("tree-sitter-")
			) {
				prebuiltWasms.push(entry.name);
			}
		}
	} catch (e) {}

	if (prebuiltWasms.length > 0) {
		log.debug(`Found prebuilt WASMs for ${dep}. Skipping build.`);
		await processPrebuiltWasm(
			prebuiltWasms,
			depPath,
			baseCleanName,
			successfulLanguages,
		);
	} else {
		const grammarDirs = await findGrammarDirs(depPath);
		if (grammarDirs.length === 0) {
			log.warn(`No grammar.js or src/grammar.json found for ${dep}. Skipping.`);
			return;
		}
		await processSourceGrammar(
			grammarDirs,
			depPath,
			baseCleanName,
			successfulLanguages,
		);
	}
}

/**
 * Main application entry point.
 */
async function main() {
	await fs.mkdir(OUT_DIR, { recursive: true });
	let pkg;

	try {
		const pkgRaw = await fs.readFile("package.json", "utf8");
		pkg = JSON.parse(pkgRaw);
	} catch (error) {
		log.error("Could not read or parse package.json.");
		process.exit(1);
	}

	const deps = Object.keys(pkg.devDependencies || {}).filter(
		(d) =>
			(d.includes("tree-sitter-") || d.endsWith("-tree-sitter")) &&
			d !== "tree-sitter-cli" &&
			d != "web-tree-sitter",
	);

	log.info(`Found ${deps.length} tree-sitter dependencies to check.`);

	const successfulLanguages = new Set();

	await pMap(deps, (dep) => processDependency(dep, successfulLanguages), {
		concurrency: 3,
	});

	const manifest = await generateManifest(successfulLanguages);
	await generateDeclarationFile(manifest);
	log.info("Build process completed.");
}

main().catch((err) => {
	log.error(`Application crash: ${err.message}`);
	process.exit(1);
});
