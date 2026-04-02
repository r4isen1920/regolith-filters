// @ts-check
"use strict";

/**
 * @typedef {{ type: "blank";   raw: string;                                             }} BlankNode
 * @typedef {{ type: "comment"; raw: string;                                             }} CommentNode
 * @typedef {{ type: "entry";   raw: string; key: string; value: string; inlineComment: string | null; }} EntryNode
 * @typedef {BlankNode | CommentNode | EntryNode} LangNode
 */

/**
 * Parse a .lang file into an ordered array of typed line nodes.
 * Preserves blank lines, `##` comments, and inline tab-delimited comments.
 *
 * @param {string} content
 * @returns {LangNode[]}
 */
function parseLang(content) {
	// Normalise line endings but keep original line text intact
	const lines = content.split(/\r?\n/);
	/** @type {LangNode[]} */
	const nodes = [];

	for (const raw of lines) {
		// Blank lines
		if (raw.trim() === "") {
			nodes.push({ type: "blank", raw });
			continue;
		}

		// Full-line comments (## ...)
		if (raw.trimStart().startsWith("##")) {
			nodes.push({ type: "comment", raw });
			continue;
		}

		// Key=value entry (mandatory: must contain '=')
		const eqIdx = raw.indexOf("=");
		if (eqIdx > 0) {
			const key = raw.slice(0, eqIdx);
			let rest = raw.slice(eqIdx + 1);
			let inlineComment = null;

			// Inline comment: <tab>## ...
			const tabIdx = rest.indexOf("\t##");
			if (tabIdx !== -1) {
				inlineComment = rest.slice(tabIdx + 1); // just the ##-onward text
				rest = rest.slice(0, tabIdx);
			}

			nodes.push({ type: "entry", raw, key, value: rest, inlineComment });
			continue;
		}

		// Unrecognised lines -- pass through verbatim
		nodes.push({ type: "blank", raw });
	}

	return nodes;
}

/**
 * Serialise nodes back to .lang text.
 * Result is identical to the source file for round-trip fidelity.
 *
 * @param {LangNode[]} nodes
 * @returns {string}
 */
function serialiseLang(nodes) {
	return nodes
		.map((n) => {
			if (n.type === "entry") {
				let line = `${n.key}=${n.value}`;
				if (n.inlineComment) line += `\t${n.inlineComment}`;
				return line;
			}
			return n.raw;
		})
		.join("\n");
}

/**
 * Build a map of entry key -> nearest preceding comment text (if any).
 * Used to supply contextual hints to LLM translators.
 *
 * @param {LangNode[]} nodes
 * @returns {Record<string, string>}
 */
function buildCommentContext(nodes) {
	/** @type {Record<string, string>} */
	const ctx = {};
	/** @type {string[]} */
	let pendingComments = [];

	for (const node of nodes) {
		if (node.type === "comment") {
			// Strip leading ## and whitespace for cleaner context
			pendingComments.push(node.raw.replace(/^[\s]*##\s?/, "").trim());
		} else if (node.type === "entry") {
			if (pendingComments.length > 0) {
				ctx[node.key] = pendingComments.join(" | ");
				pendingComments = [];
			}
		} else if (node.type === "blank") {
			// A blank line resets the pending comment accumulator;
			// comments followed by blank lines are section headers, not per-entry context
			pendingComments = [];
		}
	}

	return ctx;
}

module.exports = { parseLang, serialiseLang, buildCommentContext };
