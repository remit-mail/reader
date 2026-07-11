/**
 * Filter-token parser for the mail search field (#428). Recognizes a fixed set
 * of `word:value` tokens typed inline with the free-text query and turns them
 * into removable chips. Only tokens the search APIs can actually honor are
 * recognized — everything else (including `in:` and `account:`, which have no
 * backing filter today) is left untouched as ordinary free-text words.
 *
 * Pure functions only: no React, no fetch. `MailListHeader` renders the chips
 * and the callers that issue search requests (`MailboxPane`, `DailyBrief`,
 * `FlaggedList`, `useSemanticSearch`) apply the parsed tokens to the params
 * each engine's API actually supports.
 */

export type SearchToken =
	| { type: "from"; raw: string; value: string }
	| { type: "hasAttachment"; raw: string }
	| { type: "isUnread"; raw: string }
	| { type: "before"; raw: string; value: string; epochSeconds: number }
	| { type: "after"; raw: string; value: string; epochSeconds: number };

export interface ParsedSearchQuery {
	/** The query text with every recognized token removed, whitespace collapsed. */
	freeText: string;
	tokens: SearchToken[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateToken(
	type: "before" | "after",
	raw: string,
	value: string,
): SearchToken | undefined {
	if (!DATE_PATTERN.test(value)) return undefined;
	const epochMs = Date.parse(`${value}T00:00:00Z`);
	if (Number.isNaN(epochMs)) return undefined;
	return { type, raw, value, epochSeconds: Math.floor(epochMs / 1000) };
}

function parseWord(word: string): SearchToken | undefined {
	const lower = word.toLowerCase();
	if (lower.startsWith("from:") && word.length > 5) {
		return { type: "from", raw: word, value: word.slice(5) };
	}
	if (lower === "has:attachment") {
		return { type: "hasAttachment", raw: word };
	}
	if (lower === "is:unread") {
		return { type: "isUnread", raw: word };
	}
	if (lower.startsWith("before:") && word.length > 7) {
		return parseDateToken("before", word, word.slice(7));
	}
	if (lower.startsWith("after:") && word.length > 6) {
		return parseDateToken("after", word, word.slice(6));
	}
	return undefined;
}

/** Split a query into recognized filter tokens and the remaining free text. */
export function parseSearchTokens(query: string): ParsedSearchQuery {
	const words = query.split(/\s+/).filter((w) => w.length > 0);
	const tokens: SearchToken[] = [];
	const freeWords: string[] = [];
	for (const word of words) {
		const token = parseWord(word);
		if (token) tokens.push(token);
		else freeWords.push(word);
	}
	return { freeText: freeWords.join(" "), tokens };
}

/** Remove one parsed token's raw text from the original query string. */
export function removeSearchToken(query: string, token: SearchToken): string {
	return query
		.split(/\s+/)
		.filter((w) => w.length > 0 && w !== token.raw)
		.join(" ");
}

/** Human label for the removable chip. */
export function searchTokenLabel(token: SearchToken): string {
	switch (token.type) {
		case "from":
			return `From: ${token.value}`;
		case "hasAttachment":
			return "Has attachment";
		case "isUnread":
			return "Unread";
		case "before":
			return `Before ${token.value}`;
		case "after":
			return `After ${token.value}`;
	}
}
