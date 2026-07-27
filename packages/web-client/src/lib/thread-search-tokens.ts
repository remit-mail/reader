/**
 * The parsed search tokens as `threadOperationsSearchThreads` parameters, plus
 * the tokens that request cannot carry.
 *
 * A token the request drops does not narrow anything, so the mailbox answers a
 * weaker question than the one that was asked and returns mail the user
 * excluded — `is:starred` handing back unstarred mail. Every token is therefore
 * accounted for exactly once: either the request carries it, or it comes back
 * as residue for the caller to apply over the returned rows
 * (`matchesSearchTokens`).
 *
 * Membership is decided by reading the request back rather than by tracking
 * which branch set what: a token is carried when the request that will be sent
 * asks for exactly what the token asks for. That covers the cases where one
 * parameter has to answer for several tokens — the endpoint takes a single
 * `from`, a single `subject` and one boolean per state, so a second `from:` or
 * a contradicting `is:read` cannot be expressed and becomes residue.
 *
 * The inbox chips own the parameters they set: a chip is a control on screen,
 * a token is text in a field, and where they disagree the visible control wins
 * and the token drops to residue (where, contradicting the chip, it matches
 * nothing — which is the honest answer to a contradiction).
 */

import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { matchesSearchTokens, toThreadRowData } from "./brief.js";
import type { InboxFilterParams, ThreadSearchQuery } from "./inbox-filters.js";
import type { SearchToken } from "./search-tokens.js";

/** The search parameters the tokens themselves set. */
export type ThreadSearchTokenParams = Pick<
	ThreadSearchQuery,
	"from" | "subject" | "category" | "unread" | "starred" | "attachments"
>;

export interface ThreadSearchTokens {
	/** What the tokens add to the request. */
	params: ThreadSearchTokenParams;
	/** The tokens the request does not carry; apply these over the rows. */
	residual: SearchToken[];
}

/** The first value wins: the endpoint takes one value per parameter. */
const firstValue = <T>(values: T[]): T | undefined => values[0];

const paramsFromTokens = (
	tokens: readonly SearchToken[],
): ThreadSearchTokenParams => {
	const from = firstValue(
		tokens.filter((t) => t.type === "from").map((t) => t.value),
	);
	const subject = firstValue(
		tokens.filter((t) => t.type === "subject").map((t) => t.value),
	);
	const category = firstValue(
		tokens.filter((t) => t.type === "category").map((t) => t.category),
	);
	const unread = firstValue(
		tokens
			.filter((t) => t.type === "isUnread" || t.type === "isRead")
			.map((t) => t.type === "isUnread"),
	);
	const starred = tokens.some((t) => t.type === "isStarred") ? true : undefined;
	const attachments = tokens.some((t) => t.type === "hasAttachment")
		? true
		: undefined;
	return {
		...(from !== undefined ? { from } : {}),
		...(subject !== undefined ? { subject } : {}),
		...(category !== undefined ? { category: [category] } : {}),
		...(unread !== undefined ? { unread } : {}),
		...(starred !== undefined ? { starred } : {}),
		...(attachments !== undefined ? { attachments } : {}),
	};
};

/** Whether the request being sent asks for exactly what this token asks for. */
const isCarried = (
	request: ThreadSearchTokenParams,
	token: SearchToken,
): boolean => {
	switch (token.type) {
		case "from":
			return request.from?.toLowerCase() === token.value.toLowerCase();
		case "subject":
			return request.subject?.toLowerCase() === token.value.toLowerCase();
		case "category":
			return (
				request.category?.length === 1 && request.category[0] === token.category
			);
		case "isUnread":
			return request.unread === true;
		case "isRead":
			return request.unread === false;
		case "isStarred":
			return request.starred === true;
		case "hasAttachment":
			return request.attachments === true;
		// No parameter on this endpoint at all: dates, the account and the
		// mailbox are the caller's to apply.
		case "before":
		case "after":
		case "in":
		case "account":
			return false;
	}
};

/**
 * Split the tokens into the parameters the thread search takes and the residue
 * the caller has to apply itself. `chipParams` are the parameters already set
 * by the inbox filter chips, which win where they overlap.
 */
export function threadSearchTokens(
	tokens: readonly SearchToken[],
	chipParams: InboxFilterParams = {},
): ThreadSearchTokens {
	const params = paramsFromTokens(tokens);
	const request: ThreadSearchTokenParams = { ...params, ...chipParams };
	return {
		params,
		residual: tokens.filter((token) => !isCarried(request, token)),
	};
}

/**
 * The rows that satisfy every residual token. Identity when there is none.
 *
 * `accountId` names the account the rows belong to. A per-mailbox listing does
 * not carry one on the row — the mailbox already answers it — and a row whose
 * account is unknown cannot satisfy `account:`, so it drops rather than showing
 * under a filter nothing verified.
 */
export function applyResidualTokens(
	threads: RemitImapThreadMessageResponse[],
	residual: readonly SearchToken[],
	accountId?: string,
): RemitImapThreadMessageResponse[] {
	if (residual.length === 0) return threads;
	const tokens = [...residual];
	return threads.filter((thread) => {
		const row = toThreadRowData(thread);
		return matchesSearchTokens(
			{ ...row, accountId: row.accountId ?? accountId },
			tokens,
		);
	});
}
