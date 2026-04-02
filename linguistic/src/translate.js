// @ts-check
"use strict";

const { LOCALE_TO_API_CODE, LOCALE_NAMES } = require("./constants");
const {
	settings,
	provider,
	fromLocale,
	effectiveBatchSize,
} = require("./settings");
const { sleep, withRetry, chunkArray } = require("./utils");

//#region color codes

const SECTION_RE = /\u00a7./g;
const PLACEHOLDER_RE = /\u27e6(\d+)\u27e7/g;

/**
 * Replace section-sign color codes with positional placeholders safe to send to any API.
 *
 * @param {string} text
 * @returns {{ protected: string; codes: string[] }}
 */
function protectColorCodes(text) {
	/** @type {string[]} */
	const codes = [];
	const out = text.replace(SECTION_RE, (match) => {
		codes.push(match);
		return `\u27e6${codes.length - 1}\u27e7`;
	});
	return { protected: out, codes };
}

/**
 * Restore placeholders back to section-sign color codes.
 *
 * @param {string} text
 * @param {string[]} codes
 * @returns {string}
 */
function restoreColorCodes(text, codes) {
	return text.replace(PLACEHOLDER_RE, (_, idx) => codes[Number(idx)] ?? "");
}

//#region json extraction

/**
 * Robustly extract the first JSON array from a free-form model response string.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractJsonArray(text) {
	// Try parsing directly first (some models return clean JSON)
	try {
		const parsed = JSON.parse(text.trim());
		if (Array.isArray(parsed)) return parsed.map(String);
		// Wrapped object: find any array value
		if (parsed && typeof parsed === "object") {
			const arr = Object.values(parsed).find(Array.isArray);
			if (arr) return arr.map(String);
		}
	} catch {
		// fall through to regex extraction
	}

	// Find the outermost JSON array in the text
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start !== -1 && end !== -1 && end > start) {
		try {
			const parsed = JSON.parse(text.slice(start, end + 1));
			if (Array.isArray(parsed)) return parsed.map(String);
		} catch {
			// fall through
		}
	}

	throw new Error("Response did not contain a parseable JSON array.");
}

//#region prompts

/**
 * Build the system prompt string for LLM translation.
 *
 * @param {string} fromLang
 * @param {string} toLang
 * @returns {string}
 */
function buildLLMSystemPrompt(fromLang, toLang) {
	const fromName = LOCALE_NAMES[fromLang] ?? fromLang;
	const toName = LOCALE_NAMES[toLang] ?? toLang;
	return (
		`You are an expert Minecraft localisation translator.\n` +
		`Translate the provided Minecraft .lang strings from ${fromName} to ${toName}.\n\n` +
		`Rules:\n` +
		`- Return ONLY a valid JSON array of translated strings, in the exact same order as the input.\n` +
		`- Preserve all printf-style formatting placeholders exactly as-is (e.g. %s, %d, %1$s, %2$s).\n` +
		`- Preserve all positional colour-code placeholders exactly as-is (e.g. \u27e60\u27e7, \u27e61\u27e7). Do NOT translate them.\n` +
		`- Do NOT translate keys -- only translate values.\n` +
		`- Do NOT include explanations, markdown, or any text outside the JSON array.\n` +
		`- If nearby context comments are provided for an entry, use them to inform the translation tone and meaning.`
	);
}

/**
 * @typedef {{ key: string; value: string; protected: string; codes: string[]; context: string | null }} TranslatePair
 */

/**
 * Build the user message for an LLM batch.
 * Each entry is represented as { key, value } in a JSON structure so the model
 * understands meaning; context comments are annotated inline.
 *
 * @param {TranslatePair[]} pairs
 * @returns {string}
 */
function buildLLMUserMessage(pairs) {
	const items = pairs.map((p) => {
		/** @type {Record<string, string>} */
		const item = { key: p.key, value: p.protected };
		if (p.context) item.context = p.context;
		return item;
	});
	return (
		`Translate the "value" fields for each of the following entries.\n` +
		`Return a JSON array of the translated value strings only, in the same order.\n\n` +
		JSON.stringify(items, null, 2)
	);
}

//#region engines

const GOOGLE_SEPARATOR = "\n|||SEPARATOR|||\n";

/**
 * Translate a single plain-text value using the free Google Translate GTX endpoint.
 *
 * @param {string} value
 * @param {string} fromCode   API language code for source.
 * @param {string} toCode     API language code for target.
 * @returns {Promise<string>}
 */
async function callGoogleSingle(value, fromCode, toCode) {
	const url =
		`https://translate.googleapis.com/translate_a/single` +
		`?client=gtx&sl=${encodeURIComponent(fromCode)}&tl=${encodeURIComponent(toCode)}` +
		`&dt=t&q=${encodeURIComponent(value)}`;

	const res = await fetch(url);

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		const err = new Error(
			`Google Translate error ${res.status}: ${res.statusText} -- ${body}`,
		);
		/** @type {any} */ (err).status = res.status;
		throw err;
	}

	const data = await res.json();
	if (!data[0] || !Array.isArray(data[0])) {
		throw new Error("Invalid response format from Google Translate.");
	}
	return data[0].map((/** @type {any} */ item) => item[0]).join("");
}

/**
 * Translate an array of plain-text values using the free Google Translate GTX endpoint.
 * Joins values with a separator, sends a single request, and splits the response.
 * Falls back to individual requests if the separator split produces a count mismatch.
 *
 * @param {string[]} values
 * @param {string} fromCode   API language code for source.
 * @param {string} toCode     API language code for target.
 * @returns {Promise<string[]>}
 */
async function callGoogle(values, fromCode, toCode) {
	const joined = values.join(GOOGLE_SEPARATOR);
	const url =
		`https://translate.googleapis.com/translate_a/single` +
		`?client=gtx&sl=${encodeURIComponent(fromCode)}&tl=${encodeURIComponent(toCode)}` +
		`&dt=t&q=${encodeURIComponent(joined)}`;

	const res = await fetch(url);

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		const err = new Error(
			`Google Translate error ${res.status}: ${res.statusText} -- ${body}`,
		);
		/** @type {any} */ (err).status = res.status;
		throw err;
	}

	const data = await res.json();
	if (!data[0] || !Array.isArray(data[0])) {
		throw new Error("Invalid response format from Google Translate.");
	}

	const translatedText = data[0]
		.map((/** @type {any} */ item) => item[0])
		.join("");
	const translated = translatedText.split(GOOGLE_SEPARATOR);

	if (translated.length === values.length) {
		return translated;
	}

	// Separator split failed -- fall back to individual requests
	const results = [];
	for (let i = 0; i < values.length; i++) {
		results.push(await callGoogleSingle(values[i], fromCode, toCode));
		if (i < values.length - 1) await sleep(200);
	}
	return results;
}

/**
 * Translate a batch of pairs via OpenAI.
 *
 * @param {TranslatePair[]} pairs
 * @param {string} fromLang
 * @param {string} toLang
 * @returns {Promise<string[]>}
 */
async function callOpenAI(pairs, fromLang, toLang) {
	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.model.key}`,
		},
		body: JSON.stringify({
			model: settings.model.id,
			messages: [
				{ role: "system", content: buildLLMSystemPrompt(fromLang, toLang) },
				{ role: "user", content: buildLLMUserMessage(pairs) },
			],
			temperature: 0.2,
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		const err = new Error(
			`OpenAI API error ${res.status}: ${res.statusText} - ${body}`,
		);
		/** @type {any} */ (err).status = res.status;
		throw err;
	}

	const json = await res.json();
	return extractJsonArray(json.choices[0].message.content);
}

/**
 * Translate a batch of pairs via Google Gemini.
 *
 * @param {TranslatePair[]} pairs
 * @param {string} fromLang
 * @param {string} toLang
 * @returns {Promise<string[]>}
 */
async function callGemini(pairs, fromLang, toLang) {
	const url =
		`https://generativelanguage.googleapis.com/v1beta/models/${settings.model.id}:generateContent` +
		`?key=${encodeURIComponent(settings.model.key)}`;

	const prompt =
		buildLLMSystemPrompt(fromLang, toLang) +
		"\n\n" +
		buildLLMUserMessage(pairs);

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			contents: [{ parts: [{ text: prompt }] }],
			generationConfig: {
				temperature: 0.2,
				responseMimeType: "application/json",
			},
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		const err = new Error(
			`Gemini API error ${res.status}: ${res.statusText} - ${body}`,
		);
		/** @type {any} */ (err).status = res.status;
		throw err;
	}

	const json = await res.json();
	const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
	return extractJsonArray(text);
}

/**
 * Translate a batch of pairs via Anthropic Claude.
 *
 * @param {TranslatePair[]} pairs
 * @param {string} fromLang
 * @param {string} toLang
 * @returns {Promise<string[]>}
 */
async function callAnthropic(pairs, fromLang, toLang) {
	const res = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": settings.model.key,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: settings.model.id,
			max_tokens: 8192,
			system: buildLLMSystemPrompt(fromLang, toLang),
			messages: [{ role: "user", content: buildLLMUserMessage(pairs) }],
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		const err = new Error(
			`Anthropic API error ${res.status}: ${res.statusText} - ${body}`,
		);
		/** @type {any} */ (err).status = res.status;
		throw err;
	}

	const json = await res.json();
	return extractJsonArray(json.content?.[0]?.text ?? "");
}

//#region dispatcher

/**
 * Translate a set of pairs to `toLang`, batching as appropriate for the provider.
 * Returns a map of key -> translated value (color codes already restored).
 *
 * @param {TranslatePair[]} pairs
 * @param {string} toLang
 * @param {string} logContext
 * @returns {Promise<Record<string, string>>}
 */
async function translateBatch(pairs, toLang, logContext) {
	const fromCode = LOCALE_TO_API_CODE[fromLocale];
	const toCode = LOCALE_TO_API_CODE[toLang];

	/** @type {Record<string, string>} */
	const results = {};

	if (provider === "google") {
		const chunks = chunkArray(pairs, effectiveBatchSize);
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];

			const protectedValues = chunk.map((p) => p.protected);
			const translated = await withRetry(
				() => callGoogle(protectedValues, fromCode, toCode),
				logContext,
			);

			chunk.forEach((p, idx) => {
				const raw = translated[idx] ?? p.protected;
				results[p.key] = restoreColorCodes(raw, p.codes);
			});

			if (i < chunks.length - 1) await sleep(settings.batch.delay);
		}
	} else {
		// LLM path
		const chunks = chunkArray(pairs, effectiveBatchSize);
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];

			let translated;
			if (provider === "openai") {
				translated = await withRetry(
					() => callOpenAI(chunk, fromLocale, toLang),
					logContext,
				);
			} else if (provider === "gemini") {
				translated = await withRetry(
					() => callGemini(chunk, fromLocale, toLang),
					logContext,
				);
			} else {
				// anthropic
				translated = await withRetry(
					() => callAnthropic(chunk, fromLocale, toLang),
					logContext,
				);
			}

			chunk.forEach((p, idx) => {
				const raw = translated[idx] ?? p.protected;
				results[p.key] = restoreColorCodes(raw, p.codes);
			});

			if (i < chunks.length - 1) await sleep(settings.batch.delay);
		}
	}

	return results;
}

module.exports = { protectColorCodes, restoreColorCodes, translateBatch };
