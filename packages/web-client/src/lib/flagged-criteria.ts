/**
 * What the Flagged view asks `listAllThreads` for, and what is left over.
 *
 * Every criterion the view offers — the category chip, the Unread and Has
 * attachment chips, and the `category:` / `is:unread` / `is:read` /
 * `has:attachment` / `is:starred` tokens typed in the field — is a column on
 * the ThreadMessage row, so all of them travel as query parameters. A criterion
 * applied over the pages loaded so far is the defect this replaces: a starred
 * collection is paged, so anything below the newest page was invisible to it
 * (#308).
 *
 * `starred` is the view rather than a criterion: the request always carries it,
 * which is what makes `is:starred` a carried token instead of residue.
 *
 * A chip beats a token where both set the same parameter — a control on screen
 * beats text in a field — and the overruled token drops to the residue, where
 * it matches nothing, which is the honest answer to a contradiction.
 */
import type {
	InboxFilterCriteria,
	InboxFilterParams,
} from "./inbox-filters.js";
import { inboxFilterParams } from "./inbox-filters.js";
import type { SearchToken } from "./search-tokens.js";
import {
	type ThreadSearchTokenParamName,
	threadSearchTokens,
} from "./thread-search-tokens.js";

/**
 * The token parameters `listAllThreads` carries. It has no `from` or `subject`
 * of its own — its one text parameter matches both at once — so those two
 * tokens stay residue rather than being dropped from a request that never had
 * them.
 */
export const FLAGGED_TOKEN_PARAMS: readonly ThreadSearchTokenParamName[] = [
	"category",
	"unread",
	"starred",
	"attachments",
];

export interface FlaggedCriteria {
	/** What the request narrows by, chips and carried tokens together. */
	criteria: InboxFilterParams;
	/** The tokens no parameter carries; apply these over the returned rows. */
	residual: SearchToken[];
}

export const flaggedCriteria = (
	chips: InboxFilterCriteria,
	tokens: readonly SearchToken[],
): FlaggedCriteria => {
	const chipParams = inboxFilterParams(chips);
	const { params, residual } = threadSearchTokens(
		tokens,
		{ ...chipParams, starred: true },
		FLAGGED_TOKEN_PARAMS,
	);
	return { criteria: { ...params, ...chipParams }, residual };
};
