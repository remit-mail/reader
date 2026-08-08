/**
 * How a search query is cut into terms.
 *
 * One implementation, because two would disagree: the token parser
 * (`web-client/src/lib/search-tokens.ts`) reads `in:"Sent Items"` as one term
 * and the brief's chips write and remove terms of the same query
 * (`brief-filter-query.ts`). A splitter that broke on whitespace alone would
 * read `is:unread` inside a quoted value as a term of its own, and editing it
 * would reach inside what the user typed between quotes.
 *
 * A value carrying whitespace is written in double quotes; an unterminated
 * quote runs to the end of the input, so a value stays one term while it is
 * still being typed.
 */

/** One whitespace-separated term of a query, with where it sits in the input. */
export interface SearchQueryWord {
	/** The term exactly as typed, quotes included. */
	raw: string;
	/** Index of the term's first character in the query. */
	start: number;
	/** Index just past the term's last character. */
	end: number;
}

/** Split a query into terms on whitespace, except inside double quotes. */
export function splitSearchWords(query: string): SearchQueryWord[] {
	const words: SearchQueryWord[] = [];
	let start = -1;
	let quoted = false;
	for (let i = 0; i < query.length; i++) {
		const char = query[i] as string;
		if (char === '"') {
			quoted = !quoted;
			if (start < 0) start = i;
			continue;
		}
		if (!quoted && /\s/.test(char)) {
			if (start >= 0) words.push({ raw: query.slice(start, i), start, end: i });
			start = -1;
			continue;
		}
		if (start < 0) start = i;
	}
	if (start >= 0) {
		words.push({ raw: query.slice(start), start, end: query.length });
	}
	return words;
}

/** A term split at its first colon: the token name and the value as typed. */
export interface SearchTermParts {
	name: string;
	/** The value with its quotes removed. */
	value: string;
	/** The value exactly as typed, quotes included. */
	rawValue: string;
}

const unquote = (value: string): string => {
	if (!value.startsWith('"')) return value;
	const inner = value.slice(1);
	return inner.endsWith('"') ? inner.slice(0, -1) : inner;
};

/**
 * Split `name:value` at the first colon. A term with no colon, or one starting
 * with a colon, is not a token attempt and returns `undefined`.
 */
export function splitSearchTerm(word: string): SearchTermParts | undefined {
	const colon = word.indexOf(":");
	if (colon <= 0) return undefined;
	const rawValue = word.slice(colon + 1);
	return {
		name: word.slice(0, colon).toLowerCase(),
		value: unquote(rawValue),
		rawValue,
	};
}

const needsQuotes = (value: string): boolean => /[\s"]/.test(value);

/**
 * A value as it is written in a query: quoted when it carries whitespace, bare
 * otherwise. The inverse of the unquoting above, so a suggestion the user picks
 * parses back to the value it was built from.
 */
export const quoteSearchTokenValue = (value: string): string =>
	needsQuotes(value) ? `"${value.replace(/"/g, "")}"` : value;

/** `name:value`, quoted as needed — the text a query carries for one token. */
export const searchTokenTerm = (name: string, value: string): string =>
	`${name}:${quoteSearchTokenValue(value)}`;
