import type {
	CategoryTone,
	FilterSheetCategory,
} from "./components/filter-sheet.js";

/**
 * The classifier's message categories.
 *
 * Mirrors the generated `MessageCategory` enum (@remit/domain-enums) by value.
 * The kit cannot import that package — it is a local build artifact
 * (`file:build/ts-enums`) and @remit/ui publishes standalone — so this is the
 * kit's one owner of the union, and every other surface narrows to it.
 */
export type ThreadCategory =
	| "uncategorized"
	| "personal"
	| "newsletter"
	| "marketing"
	| "automated"
	| "transactional"
	| "social";

/** "all" (no category narrowing) plus every content-type category. */
export type BriefCategoryFilter = ThreadCategory | "all";

/** How one category reads: on a chip, on a row badge, as a brief section. */
export interface CategoryPresentation {
	category: ThreadCategory;
	/** The one word every surface calls this category: chip, badge, section. */
	label: string;
	tone: CategoryTone;
	/** Place in the brief's section order, 1-based. */
	section: number;
}

/**
 * The canonical presentation of every message category, in chip-row order.
 * Pinned by `category-presentation.stories.tsx`.
 *
 * A category reads the same word wherever it is named — including on the row
 * badge, which drops the separate "receipt" and "notification" wording: a reader
 * who picks the Transactional chip has to be able to see that it was that chip
 * which produced the badge.
 *
 * The tones are the row badge's, the surface the reader meets thousands of
 * times: Personal accents, Transactional reads positive, Social warns, and
 * everything else is neutral. Marketing is not a hazard and does not warn.
 *
 * The chip row leads with All and puts Unclassified straight after Personal —
 * pending classification is a named state, offered where the reader looks for
 * their own mail. The section order ends with it instead: a section for mail the
 * classifier has not reached belongs under the mail it has (issue #45).
 */
export const CATEGORY_PRESENTATION: readonly CategoryPresentation[] = [
	{ category: "personal", label: "Personal", tone: "accent", section: 1 },
	{
		category: "uncategorized",
		label: "Unclassified",
		tone: "neutral",
		section: 7,
	},
	{
		category: "transactional",
		label: "Transactional",
		tone: "positive",
		section: 2,
	},
	{ category: "newsletter", label: "Newsletter", tone: "neutral", section: 3 },
	{ category: "marketing", label: "Marketing", tone: "neutral", section: 4 },
	{ category: "social", label: "Social", tone: "warning", section: 5 },
	{ category: "automated", label: "Automated", tone: "neutral", section: 6 },
];

/** Every category in the brief's section order, which ends with Unclassified. */
export const CATEGORY_SECTION_ORDER: readonly ThreadCategory[] = [
	...CATEGORY_PRESENTATION,
]
	.sort((a, b) => a.section - b.section)
	.map((entry) => entry.category);

// The table is exhaustive over the union, so the keys are the union — which is
// more than `Object.fromEntries` can say in its return type.
const byCategory = <T>(
	pick: (entry: CategoryPresentation) => T,
): Record<ThreadCategory, T> =>
	Object.fromEntries(
		CATEGORY_PRESENTATION.map((entry) => [entry.category, pick(entry)]),
	) as Record<ThreadCategory, T>;

/** The word every surface shows for a category. */
export const categoryLabels: Record<ThreadCategory, string> = byCategory(
	(entry) => entry.label,
);

/** The tone every surface gives a category. */
export const categoryTone: Record<ThreadCategory, CategoryTone> = byCategory(
	(entry) => entry.tone,
);

/**
 * The badge's label for a category, or null where no badge belongs.
 *
 * `personal` is the default and never renders a badge. `uncategorized` does: it
 * used to be displayed as `personal`, which made "the classifier never ran on
 * this message" indistinguishable from "the classifier decided this is a person
 * writing to you" — a classification gap presented as a full personal inbox
 * (issue #45).
 */
export const getCategoryLabel = (
	category: ThreadCategory | undefined,
): string | null => {
	if (!category || category === "personal") return null;
	return categoryLabels[category];
};

/**
 * Whether a string names one of the classifier's categories. A host reading a
 * category off the API narrows it with this rather than asserting it: a value
 * from a newer server that this build has no tone for is a value it cannot
 * render, and it needs to know that rather than find out at lookup time.
 */
export function isThreadCategory(value: string): value is ThreadCategory {
	return Object.hasOwn(categoryTone, value);
}

/**
 * Whether an id names one of the brief's category scopes. A host holding one
 * category across views whose sheets speak plain strings narrows it with this
 * rather than asserting it.
 */
export function isBriefCategory(id: string): id is BriefCategoryFilter {
	return id === "all" || isThreadCategory(id);
}

/**
 * The category chips for every filter sheet, in chip-row order. The leading
 * "all" clears the category. Per message, not per mailbox — so they apply in the
 * brief and an inbox alike.
 */
export const categoryChips: readonly FilterSheetCategory[] = [
	{ id: "all", label: "All", tone: "neutral" },
	...CATEGORY_PRESENTATION.map((entry) => ({
		id: entry.category,
		label: entry.label,
		tone: entry.tone,
	})),
];
