// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { MAX_RETRIES } = require("./constants");

//#region filesystem

/** @param {string} dirPath */
function ensureDir(dirPath) {
	if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * @param {string} filePath
 * @returns {any | null}
 */
function loadJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

/**
 * @param {string} filePath
 * @param {any} data
 */
function saveJson(filePath, data) {
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, JSON.stringify(data, null, "\t"), "utf8");
}

/** @param {string} content */
function hashContent(content) {
	return crypto.createHash("sha256").update(content).digest("hex");
}

//#region async

/** @param {number} ms */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with exponential-backoff retry on rate-limit / server errors.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} _context  Label shown in retry log messages.
 * @returns {Promise<T>}
 */
async function withRetry(fn, _context) {
	let lastErr;
	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await fn();
		} catch (/** @type {any} */ err) {
			lastErr = err;
			const status = err.status;
			const retryable =
				status === 429 ||
				status === 500 ||
				status === 503 ||
				(err.message || "").includes("429");
			if (retryable && attempt < MAX_RETRIES) {
				const wait = attempt * 2;
				console.warn(
					`  ├── Rate limited / server error (HTTP ${status}). ` +
						`Retrying in ${wait}s (attempt ${attempt}/${MAX_RETRIES})...`,
				);
				await sleep(wait * 1000);
			} else {
				break;
			}
		}
	}
	throw lastErr;
}

//#region arrays

/**
 * @template T
 * @param {T[]} arr
 * @param {number} size
 * @returns {T[][]}
 */
function chunkArray(arr, size) {
	/** @type {T[][]} */
	const chunks = [];
	for (let i = 0; i < arr.length; i += size) {
		chunks.push(arr.slice(i, i + size));
	}
	return chunks;
}

module.exports = {
	ensureDir,
	loadJson,
	saveJson,
	hashContent,
	sleep,
	withRetry,
	chunkArray,
};
