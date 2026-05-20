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
			if (entry.isFile() && entry.name === "grammar.js") {
				hasGrammarJs = true;
			} else if (entry.isDirectory() && entry.name === "src") {
				hasSrcDir = true;
			}
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
 * Copies .scm query files from the grammar directory (and its 'queries' subfolder)
 * as well as the root dependency directory to handle shared queries.
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

async function main() {
	await fs.mkdir(OUT_DIR, { recursive: true });

	let pkg;
	try {
		const pkgRaw = await fs.readFile("package.json", "utf8");
		pkg = JSON.parse(pkgRaw);
	} catch (error) {
		console.error("[FATAL] Could not read or parse package.json.");
		process.exit(1);
	}

	const deps = Object.keys(pkg.devDependencies || {}).filter(
		(d) =>
			(d.includes("tree-sitter-") || d.endsWith("-tree-sitter")) &&
			d !== "tree-sitter-cli",
	);

	console.log(`Found ${deps.length} tree-sitter dependencies to check.`);

	const compileGrammar = async (dep) => {
		const depPath = path.resolve("node_modules", dep);

		try {
			await fs.access(depPath);
		} catch {
			console.warn(`[WARN] Directory missing for ${dep}. Did you run install?`);
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
			console.log(`[INFO] Found prebuilt WASMs for ${dep}. Skipping build.`);
			for (const wasmFile of prebuiltWasms) {
				const cleanWasmName = wasmFile
					.replace(/\.wasm$/, "")
					.replace(/^tree-sitter-/, "")
					.replace(/_/g, "-");

				let langName;
				if (
					cleanWasmName.startsWith(baseCleanName) ||
					cleanWasmName === baseCleanName
				) {
					langName = cleanWasmName;
				} else {
					langName = `${baseCleanName}-${cleanWasmName}`;
				}

				const langOutDir = path.join(OUT_DIR, langName);

				try {
					await fs.mkdir(langOutDir, { recursive: true });
					await fs.copyFile(
						path.join(depPath, wasmFile),
						path.join(langOutDir, wasmFile),
					);
					await copyScmFiles(depPath, langOutDir, depPath); // Pass depPath as grammar dir

					console.log(
						`[SUCCESS] Copied prebuilt WASM and queries for ${langName}`,
					);
				} catch (error) {
					console.error(
						`[ERROR] Failed to process prebuilt WASM ${wasmFile}:\n  -> ${error.message}`,
					);
				}
			}
			return;
		}

		const grammarDirs = await findGrammarDirs(depPath);

		if (grammarDirs.length === 0) {
			console.warn(
				`[WARN] No grammar.js or src/grammar.json found for ${dep}. Skipping.`,
			);
			return;
		}

		for (const grammarDir of grammarDirs) {
			const relativeName = path.relative(
				path.resolve("node_modules"),
				grammarDir,
			);

			let langName;
			if (grammarDir === depPath) {
				langName = baseCleanName;
			} else {
				const folderName = path.basename(grammarDir);
				const cleanFolderName = folderName.replace(/^tree-sitter-/, "");

				if (
					cleanFolderName.startsWith(baseCleanName) ||
					cleanFolderName === baseCleanName
				) {
					langName = cleanFolderName;
				} else {
					langName = `${baseCleanName}-${cleanFolderName}`;
				}
			}

			const langOutDir = path.join(OUT_DIR, langName);

			try {
				await fs.mkdir(langOutDir, { recursive: true });
				console.log(
					`Building WASM for ${relativeName} into out/${langName}...`,
				);

				await execAsync(`pnpm exec tree-sitter build --wasm "${grammarDir}"`, {
					cwd: langOutDir,
				});

				await copyScmFiles(grammarDir, langOutDir, depPath);

				console.log(`[SUCCESS] Compiled and copied queries for ${langName}`);
			} catch (error) {
				console.error(
					`[ERROR] Failed to process ${relativeName}:\n  -> ${error.message.split("\n")[0]}`,
				);
			}
		}
	};

	await pMap(deps, compileGrammar, { concurrency: 5 });
	console.log("\n[DONE] Build process completed.");
}

main().catch((err) => console.error("[FATAL ERROR]", err));
