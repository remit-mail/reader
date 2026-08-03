/**
 * The brief's chips as terms of the search query (#460).
 *
 * While something is being searched, a chip and a typed term are the same
 * thing: ticking "Unread" over `Odido` leaves `Odido is:unread` in the field,
 * which the user can read, edit and delete, and deleting it unticks the chip.
 * The vocabulary is the one the search field already parses — `is:unread`,
 * `has:attachment`, `category:<id>` — so a chip writes a term the engines
 * already honour rather than a second, invisible filter stack over the same
 * rows.
 *
 * Two of the brief's chips have no term in that vocabulary: "From contacts"
 * matches on sender trust, which no facet names, and "Today" is a relative
 * window where the vocabulary carries only absolute `before:`/`after:` dates.
 * Those two keep narrowing from the panel's own state, which is why
 * {@link briefChipFilters} carries them across a search rather than dropping
 * them.
 *
 * Pure string work: the app parses the same query with the full token parser
 * and the workbench shell has none, so what both share is this.
 */

import {
	type BriefCategoryFilter,
	isBriefCategory,
} from "../components/app-shell-types.js";
import type { BriefFilterId } from "../components/brief-sections.js";

const FILTER_TERMS: ReadonlyArray<readonly [BriefFilterId, string]> = [
	["unread", "is:unread"],
	["attachment", "has:attachment"],
];

const CATEGORY_TERM_PREFIX = "category:";

/** Category spellings beyond the ids themselves, as the token parser reads them. */
const CATEGORY_ALIASES: Record<string, BriefCategoryFilter> = {
	unclassified: "uncategorized",
};

const queryWords = (query: string): string[] =>
	query.split(/\s+/).filter((word) => word.length > 0);

/** The term a chip writes into the query, or `undefined` when it has none. */
export const briefFilterTerm = (id: BriefFilterId): string | undefined =>
	FILTER_TERMS.find(([filterId]) => filterId === id)?.[1];

/** Whether a chip is one the search vocabulary can express. */
export const briefFilterHasTerm = (id: BriefFilterId): boolean =>
	briefFilterTerm(id) !== undefined;

/** The chips the search vocabulary can express, in the order the panel lists them. */
export const briefFilterTermIds: readonly BriefFilterId[] = FILTER_TERMS.map(
	([id]) => id,
);

const categoryOfWord = (word: string): BriefCategoryFilter | undefined => {
	const lower = word.toLowerCase();
	if (!lower.startsWith(CATEGORY_TERM_PREFIX)) return undefined;
	const value = lower.slice(CATEGORY_TERM_PREFIX.length);
	const alias = CATEGORY_ALIASES[value];
	if (alias) return alias;
	if (!isBriefCategory(value) || value === "all") return undefined;
	return value;
};

/** The chips a query's own terms tick. */
export const briefQueryFilters = (
	query: string,
): ReadonlySet<BriefFilterId> => {
	const words = new Set(queryWords(query).map((word) => word.toLowerCase()));
	return new Set(
		FILTER_TERMS.filter(([, term]) => words.has(term)).map(([id]) => id),
	);
};

/** The category a query is scoped to by its own terms, `"all"` when none is. */
export const briefQueryCategory = (query: string): BriefCategoryFilter => {
	let category: BriefCategoryFilter = "all";
	for (const word of queryWords(query)) {
		const named = categoryOfWord(word);
		if (named) category = named;
	}
	return category;
};

/**
 * The query with a chip's term written in or taken out, or `undefined` when the
 * chip has no term — the caller narrows the same rows from the panel's own
 * state instead, rather than pressing a control that writes nothing.
 */
export const toggleBriefFilterInQuery = (
	query: string,
	id: BriefFilterId,
): string | undefined => {
	const term = briefFilterTerm(id);
	if (!term) return undefined;
	const words = queryWords(query);
	const kept = words.filter((word) => word.toLowerCase() !== term);
	if (kept.length < words.length) return kept.join(" ");
	return [...words, term].join(" ");
};

/** The query scoped to one category, or with its category term taken out for `"all"`. */
export const setBriefCategoryInQuery = (
	query: string,
	category: BriefCategoryFilter,
): string => {
	const kept = queryWords(query).filter((word) => !categoryOfWord(word));
	if (category === "all") return kept.join(" ");
	return [...kept, `${CATEGORY_TERM_PREFIX}${category}`].join(" ");
};

/** The query with every chip term taken out, leaving what was typed. */
export const clearBriefFiltersInQuery = (query: string): string => {
	const terms = new Set(FILTER_TERMS.map(([, term]) => term));
	return queryWords(query)
		.filter((word) => !terms.has(word.toLowerCase()) && !categoryOfWord(word))
		.join(" ");
};

/** Whether a query is narrowing the list — the state in which chips are terms. */
export const briefQueryIsActive = (query: string): boolean =>
	query.trim().length > 0;

/**
 * The chips shown ticked. Under a query the terms are the whole answer for
 * every chip that has one; the two that have none keep answering to the panel's
 * own state, so a search never silently stops them narrowing.
 */
export const briefChipFilters = (input: {
	query: string;
	ownFilters: ReadonlySet<BriefFilterId>;
}): ReadonlySet<BriefFilterId> => {
	if (!briefQueryIsActive(input.query)) return input.ownFilters;
	const ticked = new Set(briefQueryFilters(input.query));
	for (const id of input.ownFilters) {
		if (!briefFilterHasTerm(id)) ticked.add(id);
	}
	return ticked;
};

/** The category scope shown selected — the query's under a query, else the panel's. */
export const briefChipCategory = (input: {
	query: string;
	ownCategory: BriefCategoryFilter;
}): BriefCategoryFilter =>
	briefQueryIsActive(input.query)
		? briefQueryCategory(input.query)
		: input.ownCategory;
