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
 * Terms are cut and read with `search-query-words.ts`, the splitter the token
 * parser itself uses, so a chip ticks for exactly what the parser applies:
 * `is:"unread"` is the unread facet, and an `is:unread` inside a quoted value
 * belongs to that value.
 */

import {
	type BriefCategoryFilter,
	isBriefCategory,
} from "../components/app-shell-types.js";
import type { BriefFilterId } from "../components/brief-sections.js";
import {
	searchTokenTerm,
	splitSearchTerm,
	splitSearchWords,
} from "./search-query-words.js";

interface FilterTerm {
	id: BriefFilterId;
	name: string;
	value: string;
}

const FILTER_TERMS: readonly FilterTerm[] = [
	{ id: "unread", name: "is", value: "unread" },
	{ id: "attachment", name: "has", value: "attachment" },
];

const CATEGORY_TERM_NAME = "category";

/** Category spellings beyond the ids themselves, as the token parser reads them. */
const CATEGORY_ALIASES: Record<string, BriefCategoryFilter> = {
	unclassified: "uncategorized",
};

const words = (query: string): string[] =>
	splitSearchWords(query).map((word) => word.raw);

const rejoin = (kept: string[]): string => kept.join(" ");

/**
 * The chip a term names, read the way the parser reads it: `is:"unread"` is the
 * unread facet, and an `is:unread` sitting inside a quoted value is not a term
 * at all.
 */
const filterOfWord = (word: string): BriefFilterId | undefined => {
	const parts = splitSearchTerm(word);
	if (!parts) return undefined;
	return FILTER_TERMS.find(
		(term) =>
			term.name === parts.name && term.value === parts.value.toLowerCase(),
	)?.id;
};

const categoryOfWord = (word: string): BriefCategoryFilter | undefined => {
	const parts = splitSearchTerm(word);
	if (!parts || parts.name !== CATEGORY_TERM_NAME) return undefined;
	const value = parts.value.toLowerCase();
	const alias = CATEGORY_ALIASES[value];
	if (alias) return alias;
	if (!isBriefCategory(value) || value === "all") return undefined;
	return value;
};

const termFor = (id: BriefFilterId): FilterTerm | undefined =>
	FILTER_TERMS.find((term) => term.id === id);

/** Whether a chip is one the search vocabulary can express. */
export const briefFilterHasTerm = (id: BriefFilterId): boolean =>
	termFor(id) !== undefined;

/** The chips a query's own terms tick. */
export const briefQueryFilters = (
	query: string,
): ReadonlySet<BriefFilterId> => {
	const ticked = new Set<BriefFilterId>();
	for (const word of words(query)) {
		const id = filterOfWord(word);
		if (id) ticked.add(id);
	}
	return ticked;
};

/** The category a query is scoped to by its own terms, `"all"` when none is. */
export const briefQueryCategory = (query: string): BriefCategoryFilter => {
	let category: BriefCategoryFilter = "all";
	for (const word of words(query)) {
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
	const term = termFor(id);
	if (!term) return undefined;
	const typed = words(query);
	const kept = typed.filter((word) => filterOfWord(word) !== id);
	if (kept.length < typed.length) return rejoin(kept);
	return rejoin([...typed, searchTokenTerm(term.name, term.value)]);
};

/** The query scoped to one category, or with its category term taken out for `"all"`. */
export const setBriefCategoryInQuery = (
	query: string,
	category: BriefCategoryFilter,
): string => {
	const kept = words(query).filter((word) => !categoryOfWord(word));
	if (category === "all") return rejoin(kept);
	return rejoin([...kept, searchTokenTerm(CATEGORY_TERM_NAME, category)]);
};

/** The query with every chip term taken out, leaving what was typed. */
export const clearBriefFiltersInQuery = (query: string): string =>
	rejoin(
		words(query).filter((word) => !filterOfWord(word) && !categoryOfWord(word)),
	);

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
