/**
 * What each daily-brief section asks `listAllThreads` for, and what is left over.
 *
 * The brief's category scope is not a criterion here: every section is its own
 * category-scoped request, so the category travels per section rather than in
 * the shared criteria. What is shared is the attribute chips and the tokens
 * typed in the field — `from:`, `subject:`, `is:unread`, `has:attachment`,
 * `is:starred` — all of them fields on the ThreadMessage row, so all of them
 * travel as query parameters over the whole scope instead of as a pass over the
 * rows already fetched (#312, #1128).
 *
 * The account pill and mute travel with them. Both used to narrow the rows after
 * they arrived, which is what took the number off every section header: a count
 * over every account, muted senders included, is not the size of a list showing
 * one account without them (#1136, #1137).
 *
 * Two chips have no parameter anywhere — "From contacts" reads `senderTrust`,
 * which is off-row (design D7), and "Today" is a date, which no listing
 * endpoint takes. They narrow the rows the kit renders, so while either is on
 * the request is wider than the list and the section totals are not the list's
 * size. `briefCountsMatchRows` is how a caller knows to show no number instead.
 */
import type { BriefFilterId } from "@remit/ui";
import type { InboxFilterParams } from "./inbox-filters.js";
import { inboxFilterParams } from "./inbox-filters.js";
import type { SearchToken } from "./search-tokens.js";
import {
	type ThreadSearchTokenParamName,
	type ThreadSearchTokenParams,
	threadSearchTokens,
} from "./thread-search-tokens.js";

/** The token parameters `listAllThreads` carries. */
export const BRIEF_TOKEN_PARAMS: readonly ThreadSearchTokenParamName[] = [
	"from",
	"subject",
	"category",
	"unread",
	"starred",
	"attachments",
];

/** Chips the request cannot express, so the caller applies them over the rows. */
export const BRIEF_CLIENT_ONLY_FILTERS: readonly BriefFilterId[] = [
	"contacts",
	"today",
];

/**
 * The chips on screen that no request carries, as the set to apply over the rows
 * that came back. Every other chip was answered by the server over the whole
 * scope, and applying one of those again here would narrow one page by a
 * criterion the request already applied to everything (#312).
 */
export const briefClientOnlyFilters = (
	attributes: ReadonlySet<string>,
): ReadonlySet<BriefFilterId> =>
	new Set(BRIEF_CLIENT_ONLY_FILTERS.filter((id) => attributes.has(id)));

/** Everything a section request narrows by except its own category. */
export type BriefSectionParams = Omit<ThreadSearchTokenParams, "category"> & {
	/** The account the pills narrow to, or absent for the whole config. */
	accountId?: string;
	/** Always `false` here: the brief renders no muted sender's mail. */
	muted?: boolean;
};

export interface BriefCriteria {
	/** What every section request carries, chips and carried tokens together. */
	criteria: BriefSectionParams;
	/** The tokens no parameter carries; apply these over the returned rows. */
	residual: SearchToken[];
}

export const briefCriteria = (
	category: string,
	attributes: ReadonlySet<string>,
	tokens: readonly SearchToken[],
	accountId?: string,
): BriefCriteria => {
	const chipParams: InboxFilterParams = inboxFilterParams({
		category,
		attributes,
	});
	const { params, residual } = threadSearchTokens(
		tokens,
		chipParams,
		BRIEF_TOKEN_PARAMS,
	);
	const request = { ...params, ...chipParams };
	// Mute is not a control the reader sets: the brief is the view that hides
	// muted senders, so every request it makes says so and every count it shows
	// is a count of what it renders.
	const criteria: BriefSectionParams = { muted: false };
	if (request.from !== undefined) criteria.from = request.from;
	if (request.subject !== undefined) criteria.subject = request.subject;
	if (request.unread !== undefined) criteria.unread = request.unread;
	if (request.starred !== undefined) criteria.starred = request.starred;
	if (request.attachments !== undefined)
		criteria.attachments = request.attachments;
	if (accountId !== undefined) criteria.accountId = accountId;
	return { criteria, residual };
};

export interface BriefCountReach {
	/** Tokens the request did not carry, applied over the rows afterwards. */
	residual: readonly SearchToken[];
	/** Attribute chips currently on. */
	attributes: ReadonlySet<string>;
}

/**
 * Whether a section's server count is a count of what the section shows.
 *
 * The count answers the request. Anything narrowing the rows after they arrive —
 * a residual token, or a chip with no parameter — makes the count the size of a
 * wider set than the list. A wider number rendered as the section's size is a
 * worse reading than no number, so the caller asks for none.
 *
 * The account pills are not among them any more, and neither is mute: both are
 * parameters the request carries, so the count narrows exactly as the list does
 * (#1136, #1137).
 */
export const briefCountsMatchRows = ({
	residual,
	attributes,
}: BriefCountReach): boolean =>
	residual.length === 0 &&
	!BRIEF_CLIENT_ONLY_FILTERS.some((id) => attributes.has(id));
