/**
 * What to offer while a search query is being typed (#428 follow-up).
 *
 * The search box takes a vocabulary of `name:value` tokens (`@remit/ui`'s `search-tokens.ts`)
 * that nothing on screen announces, so the tokens are only useful to someone who
 * already knows they exist. This turns the query and the caret into the list of
 * completions for the term under the caret: token names while a bare word is
 * being typed, that token's values once its name is committed.
 *
 * Pure functions over data passed in. Values that need looking up — folders,
 * accounts, contacts — are supplied by the caller; `searchSuggestionRequest`
 * says which lookup the current caret position needs, so a hook can fetch
 * exactly that and nothing per keystroke. The address lookup for `from:` is the
 * one the compose recipient field already uses
 * (`addressOperationsSearchAddresses`); no new endpoint exists for this.
 *
 * The offer is a shortcut and never a constraint: nothing here rejects or
 * rewrites what was typed, and a term with no matches leaves the plain text box
 * it always was.
 */

import type { Suggestion } from "@remit/ui";
import {
	SEARCH_TOKEN_SPECS,
	type SearchTokenName,
	type SearchTokenSpec,
	type SearchTokenValueSource,
	searchTokenSpec,
	searchTokenTerm,
	splitSearchTerm,
	splitSearchWords,
} from "@remit/ui";

/** How many suggestions the list shows at most. */
export const SEARCH_SUGGESTION_LIMIT = 8;

/** The term the caret sits in, and where it sits in the query. */
export interface ActiveSearchTerm {
	/** Index of the term's first character. */
	start: number;
	/** Index just past the term's last character. */
	end: number;
	/** The term exactly as typed. Empty when the caret is on whitespace. */
	raw: string;
	/** The token name typed before the colon, lower-cased. Absent for a bare word. */
	name?: string;
	/** What has been typed of the value, unquoted. Absent for a bare word. */
	value?: string;
}

/**
 * The term the caret is in. A caret on whitespace (or in an empty box) is an
 * empty term at that position, so the caller still gets the vocabulary offered
 * rather than nothing — whether to show it there is the UI's call.
 */
export function activeSearchTerm(
	query: string,
	cursor: number,
): ActiveSearchTerm {
	const caret = Math.max(0, Math.min(cursor, query.length));
	const word = splitSearchWords(query).find(
		(w) => caret >= w.start && caret <= w.end,
	);
	if (!word) return { start: caret, end: caret, raw: "" };
	const parts = splitSearchTerm(word.raw);
	if (!parts) return { start: word.start, end: word.end, raw: word.raw };
	return {
		start: word.start,
		end: word.end,
		raw: word.raw,
		name: parts.name,
		value: parts.value,
	};
}

/** What the caret position needs offered: a token name, or one token's values. */
export interface SearchSuggestionRequest {
	kind: "token" | "value";
	/** The token whose values are wanted, for a `value` request. */
	token?: SearchTokenName;
	/** Where those values come from, for a `value` request. */
	source?: SearchTokenValueSource;
	/** What has been typed of the name or the value. */
	query: string;
}

/**
 * The lookup the caret position calls for, so a hook fetches folders, accounts,
 * or addresses only where they can be offered. `undefined` when the term is an
 * unknown `foo:bar` — a token the vocabulary does not carry has no completions,
 * and the term stays free text.
 */
export function searchSuggestionRequest(
	query: string,
	cursor: number,
): SearchSuggestionRequest | undefined {
	const term = activeSearchTerm(query, cursor);
	if (term.name === undefined) return { kind: "token", query: term.raw };
	const spec = searchTokenSpec(term.name);
	if (!spec) return undefined;
	return {
		kind: "value",
		token: spec.name,
		source: spec.values,
		query: term.value ?? "",
	};
}

/** A value the caller looked up, ready to be offered for one token. */
export interface SearchSuggestionValue {
	value: string;
	/** What the row reads. Defaults to the value. */
	label?: string;
	/** Secondary text — the address behind a display name, say. */
	hint?: string;
}

/** The looked-up values available for the tokens that take them. */
export interface SearchSuggestionData {
	/** Folder names, for `in:`. */
	mailboxes?: readonly SearchSuggestionValue[];
	/** Account names, for `account:`. */
	accounts?: readonly SearchSuggestionValue[];
	/** Known addresses, for `from:` — the address search's results. */
	contacts?: readonly SearchSuggestionValue[];
}

const SOURCE_DATA: Partial<
	Record<SearchTokenValueSource, keyof SearchSuggestionData>
> = {
	mailbox: "mailboxes",
	account: "accounts",
	contact: "contacts",
};

const valuesFor = (
	spec: SearchTokenSpec,
	data: SearchSuggestionData,
): readonly SearchSuggestionValue[] => {
	if (spec.values === "fixed") return spec.options ?? [];
	const key = SOURCE_DATA[spec.values];
	// `date` and `text` values are typed, not chosen — a date has no list worth
	// offering and free text has nothing to draw on.
	return key ? (data[key] ?? []) : [];
};

const matchRank = (haystack: string, needle: string): number => {
	if (needle === "") return 1;
	const lower = haystack.toLowerCase();
	if (lower.startsWith(needle)) return 0;
	return lower.includes(needle) ? 1 : -1;
};

const rankOf = (needle: string, ...fields: (string | undefined)[]): number => {
	let best = -1;
	for (const field of fields) {
		if (field === undefined) continue;
		const rank = matchRank(field, needle);
		if (rank < 0) continue;
		if (best < 0 || rank < best) best = rank;
	}
	return best;
};

interface Ranked {
	rank: number;
	suggestion: Suggestion;
}

const take = (ranked: Ranked[]): Suggestion[] => {
	const seen = new Set<string>();
	return ranked
		.filter((r) => r.rank >= 0)
		.sort((a, b) => a.rank - b.rank)
		.filter((r) => {
			const key = r.suggestion.value.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, SEARCH_SUGGESTION_LIMIT)
		.map((r) => r.suggestion);
};

const nameSuggestion = (spec: SearchTokenSpec): Suggestion => ({
	value: `${spec.name}:`,
	label: `${spec.name}:`,
	hint: spec.label,
});

/**
 * Token-name completions for a bare word: one row per token, `name:`, leaving
 * the caret ready for the value.
 *
 * Once something is typed, a token whose values are a fixed vocabulary also
 * offers each value whole — `is:unread` — so the words the user knows reach the
 * token they belong to without knowing its name. On an empty box that expansion
 * would bury the vocabulary under its own values, so the bare names stand alone.
 */
function tokenSuggestions(typed: string): Suggestion[] {
	const needle = typed.trim().toLowerCase();
	if (needle === "") return SEARCH_TOKEN_SPECS.map(nameSuggestion);
	const ranked: Ranked[] = [];
	for (const spec of SEARCH_TOKEN_SPECS) {
		ranked.push({
			rank: rankOf(needle, `${spec.name}:`, spec.label),
			suggestion: nameSuggestion(spec),
		});
		if (spec.values !== "fixed") continue;
		for (const option of spec.options ?? []) {
			const term = searchTokenTerm(spec.name, option.value);
			ranked.push({
				rank: rankOf(needle, term, option.label),
				suggestion: { value: term, label: option.label ?? term, hint: term },
			});
		}
	}
	return take(ranked);
}

/**
 * Value completions for a committed token name. Each offer is the whole term —
 * `in:"Sent Items"`, quoted where the value needs it — so applying one is a
 * replacement of the term under the caret and never a splice the caller has to
 * quote itself.
 */
function valueSuggestions(
	spec: SearchTokenSpec,
	typed: string,
	data: SearchSuggestionData,
): Suggestion[] {
	const needle = typed.trim().toLowerCase();
	const ranked = valuesFor(spec, data).map<Ranked>((option) => ({
		rank: rankOf(needle, option.value, option.label),
		suggestion: {
			value: searchTokenTerm(spec.name, option.value),
			label: option.label ?? option.value,
			...(option.hint ? { hint: option.hint } : {}),
		},
	}));
	return take(ranked);
}

/**
 * The completions for the term under the caret. An unknown token name offers
 * nothing: `foo:bar` is free text, and a list of guesses would suggest otherwise.
 */
export function buildSearchSuggestions(
	query: string,
	cursor: number,
	data: SearchSuggestionData = {},
): Suggestion[] {
	const term = activeSearchTerm(query, cursor);
	if (term.name === undefined) return tokenSuggestions(term.raw);
	const spec = searchTokenSpec(term.name);
	if (!spec) return [];
	return valueSuggestions(spec, term.value ?? "", data);
}

/** A query and where the caret lands in it, after a suggestion is applied. */
export interface AppliedSearchSuggestion {
	query: string;
	cursor: number;
}

/**
 * Replace the term under the caret with the suggestion. A completed token gets a
 * trailing space — the term is finished, the next one starts — while a bare
 * `name:` does not, because the value still has to be typed.
 */
export function applySearchSuggestion(
	query: string,
	cursor: number,
	suggestion: Suggestion,
): AppliedSearchSuggestion {
	const term = activeSearchTerm(query, cursor);
	const complete = !suggestion.value.endsWith(":");
	const followed = /\s/.test(query.slice(term.end, term.end + 1));
	const insert =
		complete && !followed ? `${suggestion.value} ` : suggestion.value;
	return {
		query: query.slice(0, term.start) + insert + query.slice(term.end),
		cursor: term.start + insert.length + (complete && followed ? 1 : 0),
	};
}

/** A contact as the address search returns it, as a suggestion value. */
export const contactSuggestionValue = (address: {
	normalizedEmail: string;
	displayName?: string | null;
}): SearchSuggestionValue => ({
	value: address.normalizedEmail,
	...(address.displayName
		? { label: address.displayName, hint: address.normalizedEmail }
		: {}),
});
