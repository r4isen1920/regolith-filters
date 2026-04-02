// @ts-check
"use strict";

const path = require("path");

//#region parsing

const settings = {
	target: {
		from: "en_US",
		to: [
			"de_DE",
			"es_ES",
			"es_MX",
			"fr_FR",
			"ja_JP",
			"pt_BR",
			"zh_CN",
		],
	},
	model: {
		id: "google",
		key: "",
	},
	batch: { size: 0, delay: 3000 },
};

if (process.argv[2]) {
	try {
		const parsed = JSON.parse(process.argv[2]);
		if (parsed.target?.from) settings.target.from = parsed.target.from;
		if (Array.isArray(parsed.target?.to)) settings.target.to = parsed.target.to;
		// TODO: model config should be stored elsewhere, CLI args are fine as another option, but they need to be put somewhere else too and invoked like from a SECRETS file
		if (parsed.model?.id) settings.model.id = parsed.model.id;
		if (parsed.model?.key) settings.model.key = parsed.model.key;
		if (typeof parsed.batch?.size === "number")
			settings.batch.size = parsed.batch.size;
		if (typeof parsed.batch?.delay === "number")
			settings.batch.delay = parsed.batch.delay;
	} catch (/** @type {any} */ err) {
		console.error("Failed to parse settings JSON:", err.message);
		process.exit(1);
	}
}

if (!settings.model.id) {
	console.error(
		"model.id is required.\n" + '  Example: { "model": { "id": "google" } }',
	);
	process.exit(1);
}

const fromLocale = settings.target.from;

// Exclude source locale from targets; deduplicate
const toLocales = [
	...new Set(settings.target.to.filter((l) => l !== fromLocale)),
];

if (toLocales.length === 0) {
	console.warn("No target locales to translate into.");
	process.exit(0);
}

//#region provider

/**
 * @param {string} modelId
 * @returns {"google" | "openai" | "gemini" | "anthropic" | null}
 */
function detectProvider(modelId) {
	if (modelId === "google") return "google";
	if (
		modelId.startsWith("gpt-") ||
		modelId.startsWith("o1") ||
		modelId.startsWith("o3")
	)
		return "openai";
	if (modelId.startsWith("gemini-")) return "gemini";
	if (modelId.startsWith("claude-")) return "anthropic";
	return null;
}

const provider = detectProvider(settings.model.id);
if (!provider) {
	console.error(
		`Unrecognised model.id "${settings.model.id}".\n` +
			'  Expected "google", "gpt-*", "gemini-*", or "claude-*".',
	);
	process.exit(1);
}

if (provider !== "google" && !settings.model.key) {
	console.error(
		`model.key is required for provider "${provider}".\n` +
			'  Example: { "model": { "id": "gemini-2.0-flash", "key": "YOUR_API_KEY" } }',
	);
	process.exit(1);
}

const effectiveBatchSize =
	settings.batch.size || (provider === "google" ? 5 : 15);

//#region paths

const packsPath = "./";

const cacheRoot = process.env.ROOT_DIR
	? path.join(
			process.env.ROOT_DIR,
			".regolith",
			"cache",
			"filters",
			"linguistic",
		)
	: path.join(".regolith", "cache", "filters", "linguistic");

const tmpRoot = process.env.ROOT_DIR
	? path.join(process.env.ROOT_DIR, ".regolith", "tmp")
	: path.join(".regolith", "tmp");

/** @param {string} toLang */
function getTranslationCachePath(toLang) {
	return path.join(
		cacheRoot,
		"translations",
		`${fromLocale}_to_${toLang}.json`,
	);
}

module.exports = {
	settings,
	fromLocale,
	toLocales,
	provider,
	effectiveBatchSize,
	packsPath,
	cacheRoot,
	tmpRoot,
	getTranslationCachePath,
};
