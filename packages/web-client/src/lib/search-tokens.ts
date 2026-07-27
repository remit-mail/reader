/**
 * Filter-token parser for the mail search field (#428). Recognizes a fixed set
 * of `word:value` tokens typed inline with the free-text query and turns them
 * into removable chips. Only tokens the search APIs can actually honor are
 * recognized — everything else is left untouched as ordinary free-text words.
 *
 * The vocabulary is the search parameters `threadOperationsSearchThreads` and
 * `semanticSearchOperationsSemanticSearch` take, said in words:
 *
 * | token                  | thread search      | semantic search        |
 * | ---------------------- | ------------------ | ---------------------- |
 * | `from:`                | `from`             | —                      |
 * | `subject:`             | `subject`          | —                      |
 * | `category:`            | `category[]`       | `category`             |
 * | `is:unread` / `is:read`| `unread`           | `isRead`               |
 * | `is:starred`           | `starred`          | `hasStars`             |
 * | `has:attachment`       | `attachments`      | `hasAttachment`        |
 * | `before:` / `after:`   | —                  | `sentDateTo` / `From`  |
 * | `in:`                  | route scope        | `mailboxId`            |
 * | `account:`             | —                  | —                      |
 *
 * A token an engine has no parameter for is applied client-side over the rows
 * that engine returned (`matchesSearchTokens` in `lib/brief.ts`), never dropped.
 *
 * `in:<mailbox>` and `account:<name>` resolve against a name index the caller
 * supplies via `SearchTokenContext` (built from the loaded mailboxes/accounts —
 * see `lib/search-token-index.ts`). An unresolvable name (no index, or no
 * match in it) is left as free text rather than becoming a chip for a filter
 * that can't actually apply. `category:` resolves the same way against a fixed
 * vocabulary, so `category:nonsense` stays free text too.
 *
 * Token names are case-insensitive. A value containing whitespace is written in
 * double quotes — `in:"Sent Items"` — and an unterminated quote runs to the end
 * of the input, so a value stays readable while it is still being typed.
 *
 * Pure functions only: no React, no fetch — the name index is injected, not
 * fetched here. `MailListHeader` renders the chips and the callers that issue
 * search requests (`MailboxPane`, `DailyBrief`, `FlaggedList`,
 * `useSemanticSearch`) apply the parsed tokens to the params each engine's API
 * actually supports.
 */

import type { RemitImapMessageCategory } from "@remit/api-http-client/types.gen.ts";
import { MessageCategory } from "@remit/domain-enums";

export type SearchToken =
	| { type: "from"; raw: string; value: string }
	| { type: "subject"; raw: string; value: string }
	| {
			type: "category";
			raw: string;
			value: string;
			category: RemitImapMessageCategory;
	  }
	| { type: "hasAttachment"; raw: string }
	| { type: "isUnread"; raw: string }
	| { type: "isRead"; raw: string }
	| { type: "isStarred"; raw: string }
	| { type: "before"; raw: string; value: string; epochSeconds: number }
	| { type: "after"; raw: string; value: string; epochSeconds: number }
	| { type: "in"; raw: string; value: string; mailboxId: string }
	| { type: "account"; raw: string; value: string; accountId: string };

export interface ParsedSearchQuery {
	/** The query text with every recognized token removed, whitespace collapsed. */
	freeText: string;
	tokens: SearchToken[];
}

/** Name lookups for resolving `in:`/`account:` tokens; see module doc. */
export interface SearchTokenContext {
	/** Mailbox name (fullPath or its last segment, lower-cased) -> mailboxId. */
	mailboxesByName?: ReadonlyMap<string, string>;
	/** Account name (email or its local-part, lower-cased) -> accountId. */
	accountsByName?: ReadonlyMap<string, string>;
}

/** The word before the colon. `is`/`has` carry their meaning in the value. */
export type SearchTokenName =
	| "from"
	| "subject"
	| "category"
	| "is"
	| "has"
	| "before"
	| "after"
	| "in"
	| "account";

/** One option of a token's fixed value vocabulary. */
export interface SearchTokenValueOption {
	value: string;
	/** What the value reads as in prose. Defaults to the value. */
	label?: string;
}

/**
 * Where a token's values come from. `fixed` is the vocabulary carried here;
 * the rest are looked up by the caller (mailboxes, accounts, the address
 * search) or typed freely.
 */
export type SearchTokenValueSource =
	| "fixed"
	| "contact"
	| "mailbox"
	| "account"
	| "date"
	| "text";

/** A token name, what it narrows by, and where its values come from. */
export interface SearchTokenSpec {
	name: SearchTokenName;
	/** What the token narrows by, in the user's words. */
	label: string;
	values: SearchTokenValueSource;
	/** The vocabulary, when `values` is `fixed`. */
	options?: readonly SearchTokenValueOption[];
}

/**
 * Category labels, keyed by the API enum. `uncategorized` reads "Unclassified"
 * — the same word the filter chips use (issue #45): mail the classifier has not
 * reached is a pending state with a name, never the absence of one.
 */
const CATEGORY_LABELS: Record<RemitImapMessageCategory, string> = {
	personal: "Personal",
	uncategorized: "Unclassified",
	transactional: "Transactional",
	newsletter: "Newsletter",
	marketing: "Marketing",
	social: "Social",
	automated: "Automated",
};

const CATEGORY_OPTIONS: readonly SearchTokenValueOption[] = Object.values(
	MessageCategory,
).map((value) => ({ value, label: CATEGORY_LABELS[value] }));

/**
 * Spellings that resolve to a category beyond the enum values themselves — the
 * label the chips show, so what the user reads is also what the user can type.
 */
const CATEGORY_ALIASES: Record<string, RemitImapMessageCategory> = {
	unclassified: "uncategorized",
};

/** The whole vocabulary, in the order a suggestion list offers it. */
export const SEARCH_TOKEN_SPECS: readonly SearchTokenSpec[] = [
	{ name: "from", label: "Sender", values: "contact" },
	{ name: "subject", label: "Subject", values: "text" },
	{
		name: "category",
		label: "Category",
		values: "fixed",
		options: CATEGORY_OPTIONS,
	},
	{
		name: "is",
		label: "State",
		values: "fixed",
		options: [
			{ value: "unread", label: "Unread" },
			{ value: "read", label: "Read" },
			{ value: "starred", label: "Starred" },
		],
	},
	{
		name: "has",
		label: "Contents",
		values: "fixed",
		options: [{ value: "attachment", label: "Has attachment" }],
	},
	{ name: "in", label: "Folder", values: "mailbox" },
	{ name: "account", label: "Account", values: "account" },
	{ name: "after", label: "Sent on or after", values: "date" },
	{ name: "before", label: "Sent before", values: "date" },
];

const SPECS_BY_NAME = new Map<string, SearchTokenSpec>(
	SEARCH_TOKEN_SPECS.map((spec) => [spec.name, spec]),
);

/** The spec for a token name, or `undefined` when the name is not one of ours. */
export const searchTokenSpec = (name: string): SearchTokenSpec | undefined =>
	SPECS_BY_NAME.get(name.toLowerCase());

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const needsQuotes = (value: string): boolean => /[\s"]/.test(value);

/**
 * A value as it is written in a query: quoted when it carries whitespace, bare
 * otherwise. The inverse of the unquoting the parser does, so a suggestion the
 * user picks parses back to the value it was built from.
 */
export const quoteSearchTokenValue = (value: string): string =>
	needsQuotes(value) ? `"${value.replace(/"/g, "")}"` : value;

/** `name:value`, quoted as needed — the text a query carries for one token. */
export const searchTokenTerm = (name: string, value: string): string =>
	`${name}:${quoteSearchTokenValue(value)}`;

const unquote = (value: string): string => {
	if (!value.startsWith('"')) return value;
	const inner = value.slice(1);
	return inner.endsWith('"') ? inner.slice(0, -1) : inner;
};

/** One whitespace-separated term of a query, with where it sits in the input. */
export interface SearchQueryWord {
	/** The term exactly as typed, quotes included. */
	raw: string;
	/** Index of the term's first character in the query. */
	start: number;
	/** Index just past the term's last character. */
	end: number;
}

/**
 * Split a query into terms on whitespace, except inside double quotes, so
 * `in:"Sent Items"` is one term. An unterminated quote runs to the end of the
 * input — a half-typed value is still one term, not a broken one.
 */
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

/** The category a `category:` value names, by enum value or by chip label. */
export function resolveCategory(
	value: string,
): RemitImapMessageCategory | undefined {
	const lower = value.toLowerCase();
	const alias = CATEGORY_ALIASES[lower];
	if (alias) return alias;
	const known = Object.values(MessageCategory).find((c) => c === lower);
	return known;
}

function parseStateToken(raw: string, value: string): SearchToken | undefined {
	switch (value.toLowerCase()) {
		case "unread":
			return { type: "isUnread", raw };
		case "read":
			return { type: "isRead", raw };
		// `flagged` is the wire name for IMAP \Flagged; "starred" is the word the
		// chips use. Both are typed, so both parse.
		case "starred":
		case "flagged":
			return { type: "isStarred", raw };
		default:
			return undefined;
	}
}

function parseWord(
	word: string,
	context: SearchTokenContext,
): SearchToken | undefined {
	const parts = splitSearchTerm(word);
	if (!parts || parts.value.length === 0) return undefined;
	const { name, value } = parts;
	switch (name) {
		case "from":
			return { type: "from", raw: word, value };
		case "subject":
			return { type: "subject", raw: word, value };
		case "category": {
			const category = resolveCategory(value);
			if (!category) return undefined;
			return { type: "category", raw: word, value, category };
		}
		case "is":
			return parseStateToken(word, value);
		case "has":
			return value.toLowerCase() === "attachment"
				? { type: "hasAttachment", raw: word }
				: undefined;
		case "before":
		case "after":
			return parseDateToken(name, word, value);
		case "in": {
			const mailboxId = context.mailboxesByName?.get(value.toLowerCase());
			if (!mailboxId) return undefined;
			return { type: "in", raw: word, value, mailboxId };
		}
		case "account": {
			const accountId = context.accountsByName?.get(value.toLowerCase());
			if (!accountId) return undefined;
			return { type: "account", raw: word, value, accountId };
		}
		default:
			return undefined;
	}
}

/** Split a query into recognized filter tokens and the remaining free text. */
export function parseSearchTokens(
	query: string,
	context: SearchTokenContext = {},
): ParsedSearchQuery {
	const tokens: SearchToken[] = [];
	const freeWords: string[] = [];
	for (const word of splitSearchWords(query)) {
		const token = parseWord(word.raw, context);
		if (token) tokens.push(token);
		else freeWords.push(word.raw);
	}
	return { freeText: freeWords.join(" "), tokens };
}

/** Remove one parsed token's raw text from the original query string. */
export function removeSearchToken(query: string, token: SearchToken): string {
	return splitSearchWords(query)
		.filter((word) => word.raw !== token.raw)
		.map((word) => word.raw)
		.join(" ");
}

/** Human label for the removable chip. */
export function searchTokenLabel(token: SearchToken): string {
	switch (token.type) {
		case "from":
			return `From: ${token.value}`;
		case "subject":
			return `Subject: ${token.value}`;
		case "category":
			return `Category: ${CATEGORY_LABELS[token.category]}`;
		case "hasAttachment":
			return "Has attachment";
		case "isUnread":
			return "Unread";
		case "isRead":
			return "Read";
		case "isStarred":
			return "Starred";
		case "before":
			return `Before ${token.value}`;
		case "after":
			return `After ${token.value}`;
		case "in":
			return `In: ${token.value}`;
		case "account":
			return `Account: ${token.value}`;
	}
}
