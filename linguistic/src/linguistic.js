// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");

const { MAX_RETRIES } = require("./constants");
const { ensureDir, loadJson, saveJson, hashContent } = require("./utils");
const { parseLang, serialiseLang, buildCommentContext } = require("./lang");
const {
	fromLocale,
	toLocales,
	packsPath,
	tmpRoot,
	getTranslationCachePath,
} = require("./settings");
const { protectColorCodes, translateBatch } = require("./translate");

/**
 * @typedef {import("./lang").EntryNode} EntryNode
 * @typedef {import("./lang").LangNode} LangNode
 * @typedef {import("./translate").TranslatePair} TranslatePair
 */

/**
 * @typedef {{ hash: string; value: string }} CacheEntry
 * @typedef {Record<string, CacheEntry>} TranslationCache
 */

//#region languages json

/**
 * Merge newly translated locales into the pack's languages.json in .regolith/tmp/.
 *
 * @param {string} pack
 * @param {string[]} newLocales
 */
function updateLanguagesJson(pack, newLocales) {
	if (newLocales.length === 0) return;

	const tmpPath = path.join(tmpRoot, pack, "texts", "languages.json");
	const sourcePath = path.join(packsPath, pack, "texts", "languages.json");

	let existing = /** @type {string[]} */ ([]);

	if (fs.existsSync(tmpPath)) {
		existing = loadJson(tmpPath) ?? [];
	} else if (fs.existsSync(sourcePath)) {
		existing = loadJson(sourcePath) ?? [];
	}

	const before = existing.length;
	const merged = [...existing];
	for (const locale of newLocales) {
		if (!merged.includes(locale)) merged.push(locale);
	}

	const added = merged.length - before;
	ensureDir(path.dirname(tmpPath));
	fs.writeFileSync(tmpPath, JSON.stringify(merged, null, "\t"), "utf8");

	if (added > 0) {
		console.log(
			`Updated ${pack} languages.json: +${added} locale${added !== 1 ? "s" : ""} (total: ${merged.length})`,
		);
	} else {
		console.log(
			`${pack} languages.json already up to date (${merged.length} locales).`,
		);
	}
}

//#region pack processor

/**
 * Process all target locales for a single pack directory (BP or RP).
 *
 * @param {string} pack   "BP" or "RP"
 * @returns {Promise<string[]>}  List of successfully translated locale codes.
 */
async function processPackTexts(pack) {
	const textsDir = path.join(packsPath, pack, "texts");
	const sourceLangPath = path.join(textsDir, `${fromLocale}.lang`);

	if (!fs.existsSync(sourceLangPath)) {
		console.log(
			`No ${pack} ${fromLocale}.lang found in ${textsDir}; skipping pack.`,
		);
		return [];
	}

	const sourceContent = fs.readFileSync(sourceLangPath, "utf8");
	const sourceNodes = parseLang(sourceContent);
	const entryNodes = /** @type {EntryNode[]} */ (
		sourceNodes.filter((n) => n.type === "entry")
	);
	const commentCtx = buildCommentContext(sourceNodes);

	console.log(`Processing ${pack} ${fromLocale}.lang...`);

	const translatedLocales = /** @type {string[]} */ ([]);

	for (let i = 0; i < toLocales.length; i++) {
		const toLang = toLocales[i];

		const logCtx = `${pack}/${toLang}`;

		// ── Translation cache (shared across packs, per-key hash) ─────────────
		const transCachePath = getTranslationCachePath(toLang);
		const transCache = /** @type {TranslationCache} */ (
			loadJson(transCachePath) ?? {}
		);

		// ── Existing target file ──────────────────────────────────────────────
		// Prefer already-written tmp output; fall back to pack source
		const tmpTargetPath = path.join(tmpRoot, pack, "texts", `${toLang}.lang`);
		const sourceTargetPath = path.join(textsDir, `${toLang}.lang`);

		let existingTargetNodes = /** @type {LangNode[]} */ ([]);
		let existingKeys = new Set(/** @type {string[]} */ ([]));

		if (fs.existsSync(tmpTargetPath)) {
			existingTargetNodes = parseLang(fs.readFileSync(tmpTargetPath, "utf8"));
		} else if (fs.existsSync(sourceTargetPath)) {
			existingTargetNodes = parseLang(
				fs.readFileSync(sourceTargetPath, "utf8"),
			);
		}

		existingKeys = new Set(
			existingTargetNodes
				.filter((n) => n.type === "entry")
				.map((n) => /** @type {EntryNode} */ (n).key),
		);

		// ── Determine work to do ──────────────────────────────────────────────
		// A key needs translation if it is not in the target file AND
		// either has no cache entry or the source value hash has changed.
		const needsTranslation = entryNodes.filter((n) => {
			if (existingKeys.has(n.key)) return false;
			const cached = transCache[n.key];
			if (!cached) return true;
			return cached.hash !== hashContent(n.value);
		});

		const fromCacheCount = entryNodes.filter((n) => {
			if (existingKeys.has(n.key)) return false;
			const cached = transCache[n.key];
			return cached && cached.hash === hashContent(n.value);
		}).length;

		console.log(
			`  ├── Translating to ${logCtx}.lang: ${needsTranslation.length} required, ${fromCacheCount} cached `,
		);

		let treeSymbol = "├──";
		if (i === toLocales.length - 1) {
			treeSymbol = "└──";
		}

		// ── Translate missing keys ────────────────────────────────────────────
		if (needsTranslation.length > 0) {
			try {
				/** @type {TranslatePair[]} */
				const pairs = needsTranslation.map((node) => {
					const { protected: prot, codes } = protectColorCodes(node.value);
					return {
						key: node.key,
						value: node.value,
						protected: prot,
						codes,
						context: commentCtx[node.key] ?? null,
					};
				});

				const newTranslations = await translateBatch(pairs, toLang, logCtx);

				let translatedCount = 0;
				for (const [key, value] of Object.entries(newTranslations)) {
					const srcNode = entryNodes.find((n) => n.key === key);
					transCache[key] = {
						hash: hashContent(srcNode ? srcNode.value : ""),
						value,
					};
					translatedCount++;
				}

				saveJson(transCachePath, transCache);
				console.log(`  ${treeSymbol} Success: ${logCtx}.lang`);
			} catch (err) {
				console.error(
					`  ${treeSymbol} Translation aborted for ${logCtx} after ${MAX_RETRIES} retries - ${/** @type {any} */ (err).message}\n` +
						` Partial cache (if any) has been saved.`,
				);
				saveJson(transCachePath, transCache);
				// Continue to next locale -- don't let one failure block others
				continue;
			}
		}

		// ── Build output (source structure, translated values) ────────────────
		/** @type {Map<string, EntryNode>} */
		const existingEntryMap = new Map(
			existingTargetNodes
				.filter((n) => n.type === "entry")
				.map((n) => [
					/** @type {EntryNode} */ (n).key,
					/** @type {EntryNode} */ (n),
				]),
		);

		const outputNodes = sourceNodes.map((node) => {
			if (node.type !== "entry") return { ...node };

			const entryNode = /** @type {EntryNode} */ (node);

			// Key already exists in target -- preserve target value
			if (existingKeys.has(entryNode.key)) {
				const existing = existingEntryMap.get(entryNode.key);
				return {
					...entryNode,
					value: existing ? existing.value : entryNode.value,
				};
			}

			// Key has a valid cached translation
			const cached = transCache[entryNode.key];
			if (cached && cached.hash === hashContent(entryNode.value)) {
				return { ...entryNode, value: cached.value };
			}

			// Fallback: use source value (shouldn't normally happen)
			return { ...entryNode };
		});

		// ── Write output ──────────────────────────────────────────────────────
		const outputDir = path.join(tmpRoot, pack, "texts");
		const outputPath = path.join(outputDir, `${toLang}.lang`);
		ensureDir(outputDir);
		fs.writeFileSync(outputPath, serialiseLang(outputNodes), "utf8");

		translatedLocales.push(toLang);
	}

	// ── Copy source .lang to tmp (so regolith picks it up) ───────────────────
	const tmpSourcePath = path.join(tmpRoot, pack, "texts", `${fromLocale}.lang`);
	if (!fs.existsSync(tmpSourcePath)) {
		ensureDir(path.dirname(tmpSourcePath));
		fs.copyFileSync(sourceLangPath, tmpSourcePath);
	}

	// ── Update languages.json ─────────────────────────────────────────────────
	updateLanguagesJson(pack, [fromLocale, ...translatedLocales]);

	return translatedLocales;
}

//#region main

async function main() {
	const packs = ["BP", "RP"];
	let totalLocales = 0;
	let totalPacks = 0;
	let startTime = Date.now();

	for (const pack of packs) {
		const translated = await processPackTexts(pack);
		if (translated.length > 0) {
			totalLocales += translated.length;
			totalPacks++;
		}
	}

	const endTime = Date.now();
	const duration = ((endTime - startTime) / 1000).toFixed(2);
	console.log(
		`Finished. ${totalLocales} locale${totalLocales !== 1 ? "s" : ""} translated across ${totalPacks} pack${totalPacks !== 1 ? "s" : ""}, took ${duration}s.`,
	);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
