import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import pMap from "p-map";

const execAsync = promisify(exec);
const OUT_DIR = path.resolve("out");

const IGNORED_DIRS = new Set([
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
 * Recursively searches a directory for folders containing a 'grammar.js' file.
 * @param {string} dir - The directory to start searching in.
 * @returns {Promise<string[]>} - An array of directory paths containing grammar.js.
 */
async function findGrammarDirs(dir) {
	const results = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		let hasGrammar = false;

		for (const entry of entries) {
			if (entry.isFile() && entry.name === "grammar.js") {
				hasGrammar = true;
			} else if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
				const subResults = await findGrammarDirs(path.join(dir, entry.name));
				results.push(...subResults);
			}
		}

		if (hasGrammar) {
			results.push(dir);
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
						await fs.access(destPath); // Do not overwrite if it exists
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
		console.error(
			"[FATAL] Could not read or parse package.json. Ensure you are in the project root.",
		);
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
			console.warn(
				`[WARN] Directory missing for ${dep}. Did you forget to run 'pnpm install'?`,
			);
			return;
		}

		const grammarDirs = await findGrammarDirs(depPath);

		if (grammarDirs.length === 0) {
			console.warn(`[WARN] No grammar.js found for ${dep}. Skipping.`);
			return;
		}

		const baseCleanName = dep
			.replace(/^@[^/]+\//, "")
			.replace(/^tree-sitter-/, "");

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
				langName =
					folderName === baseCleanName
						? folderName
						: `${baseCleanName}-${folderName}`;
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

main().catch((err) =>
	console.error("[FATAL ERROR] An unexpected top-level error occurred:", err),
);
