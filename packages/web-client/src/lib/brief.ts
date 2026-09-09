/**
 * Daily brief section assembly.
 *
 * Pure function: takes one complete per-category server response and returns one
 * section per message category, in a fixed display order:
 *
 *  1. Personal
 *  2. Transactional
 *  3. Newsletter
 *  4. Marketing
 *  5. Social
 *  6. Automated
 *  7. Unclassified
 *
 * Each section is its own server query, scoped to its category and carrying
 * every criterion on screen the request can express, plus one count for the
 * whole category. Nothing here groups a page: a category whose mail is entirely
 * older than the newest unified page still has a section, and the section's
 * header states the category's real size rather than how many of a shared window
 * happened to fall in it (#312). `uncategorized` is its own section rather than
 * being folded into Personal — unclassified mail is missing work, not a decision
 * (issue #45). Starred mail is not a section — the star is a per-row marker, so
 * a starred message stays in its category.
 *
 * Sender trust (vip/wellknown) no longer sections the brief — the signal is
 * still carried on each row (see `toThreadRowData`) for future use, but it does
 * not decide where a row lands. Read state is likewise not a routing signal: in
 * a high-volume mailbox read≠handled and unread≠important; unread is a
 * user-selectable filter chip instead.
 *
 * Muted senders and categories the scope holds none of are excluded. Mute is
 * `muted=false` on each section's request, so the rows and the count answer the
 * same predicate — dropping muted rows here instead left a header stating a
 * number larger than the list under it, and a "Show all" that opened mail the
 * brief would not render (#1137).
 */

import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	CATEGORY_SECTION_ORDER,
	categoryLabels,
	type ResultCount,
	type SenderTrustLevel,
	type ThreadCategory,
	type ThreadRowData,
	type ThreadSection,
} from "@remit/ui";
import { toDisplayCategory } from "./display-category.js";
import { formatEmailDate } from "./format.js";
import { rowSettlement } from "./row-settlement.js";
import type { SearchToken } from "./search-tokens.js";

/**
 * Map a `RemitImapThreadMessageResponse` to the `ThreadRowData` shape used by
 * remit-ui row body components. Mirrors the logic in MessageListItem so the
 * brief rows render identically to per-mailbox rows.
 */
export function toThreadRowData(
	thread: RemitImapThreadMessageResponse,
): ThreadRowData {
	const suspicious = thread.authenticity?.dkimMismatch === true;
	return {
		id: thread.messageId,
		accountId: thread.accountId,
		mailboxId: thread.mailboxId,
		threadId: thread.threadId,
		fromName: thread.fromName ?? thread.fromEmail ?? "Unknown",
		fromEmail: thread.fromEmail ?? "",
		subject: thread.subject ?? "(No subject)",
		snippet: thread.snippet ?? "",
		timeLabel: formatEmailDate(thread.sentDate),
		sentDate: thread.sentDate,
		isRead: thread.isRead,
		hasAttachment: thread.hasAttachment,
		starred: thread.hasStars === true,
		trust: thread.senderTrust as SenderTrustLevel,
		category: toDisplayCategory(thread.category),
		suspicious,
		...rowSettlement(thread),
	};
}

/**
 * The categories the brief asks for, in the order it renders them. A category
 * is both the section's own scope and the query parameter its request carries;
 * the order and the label come from the kit's category table.
 */
export const BRIEF_CATEGORIES: readonly ThreadCategory[] =
	CATEGORY_SECTION_ORDER;

/** One category's own server answer: its newest rows and how many it holds. */
export interface BriefCategoryResult {
	category: ThreadCategory;
	/** The newest rows the section's request returned, newest first. */
	rows: ThreadRowData[];
	/** The category's size over the whole scope, or no number at all. */
	total: ResultCount;
	/** The request came back full, so the category holds more than these rows. */
	atCap: boolean;
	/** The request has not answered yet. */
	loading: boolean;
	/** The request failed. This category alone; the others are unaffected. */
	failed: boolean;
}

/**
 * The per-category server answers as brief sections, in display order.
 *
 * A regrouping of complete responses, never of a page: each result already is
 * its whole category as far as the request was concerned, so no further page can
 * move a section's membership or its total.
 *
 * A category the scope holds none of has no section — a header stating zero is
 * noise, not information. A category still being fetched, or whose own request
 * failed, keeps its section so the loading and error treatments have somewhere
 * to render, and a category with a real total keeps its section even with no
 * rows left after the chips, so the reader sees which filter emptied it.
 */
export function briefSections(
	results: readonly BriefCategoryResult[],
): ThreadSection[] {
	const byCategory = new Map(
		results.map((result) => [result.category, result] as const),
	);
	const sections: ThreadSection[] = [];
	for (const category of BRIEF_CATEGORIES) {
		const result = byCategory.get(category);
		if (!result) continue;
		const holdsMail =
			result.loading ||
			result.failed ||
			result.rows.length > 0 ||
			(result.total.kind === "exact" && result.total.value > 0);
		if (!holdsMail) continue;
		sections.push({
			id: category,
			label: categoryLabels[category],
			threads: result.rows,
			total: result.total,
			atCap: result.atCap,
			loading: result.loading,
			error: result.failed,
		});
	}
	return sections;
}

/**
 * Returns true when `t` satisfies every token handed to it.
 *
 * The residue applier: callers pass the tokens their request could not carry —
 * `threadSearchTokens` decides which those are by reading the request back — and
 * this narrows the rows that came back by them. A token the request did carry
 * must not be passed here; the server already answered it over the whole scope,
 * and re-answering it over one page is how a criterion ends up meaning "among
 * the rows fetched so far" (#312).
 *
 * Every token is implemented so that a request carrying fewer parameters still
 * has somewhere to put the rest: no endpoint has `before:`, `after:`, `in:` or
 * `account:` in the set these tokens are split against, and each takes one
 * `from` and one `subject`, so a second of either — or one a chip overruled —
 * lands here. A row without the data a token needs (no `sentDate` for
 * `before:`/`after:`) never matches it, so it drops out rather than showing
 * under an unverifiable filter.
 */
export function matchesSearchTokens(
	t: ThreadRowData,
	tokens: SearchToken[],
): boolean {
	return tokens.every((token) => {
		switch (token.type) {
			case "from": {
				const needle = token.value.toLowerCase();
				return (
					t.fromEmail.toLowerCase().includes(needle) ||
					t.fromName.toLowerCase().includes(needle)
				);
			}
			case "subject":
				return t.subject.toLowerCase().includes(token.value.toLowerCase());
			// A row with no category is `uncategorized` — the pending state has a
			// name (issue #45), so `category:unclassified` finds it.
			case "category":
				return (t.category ?? "uncategorized") === token.category;
			case "hasAttachment":
				return t.hasAttachment === true;
			case "isUnread":
				return !t.isRead;
			case "isRead":
				return t.isRead === true;
			case "isStarred":
				return t.starred === true;
			case "after":
				return t.sentDate != null && t.sentDate >= token.epochSeconds * 1000;
			case "before":
				return t.sentDate != null && t.sentDate < token.epochSeconds * 1000;
			case "in":
				return t.mailboxId === token.mailboxId;
			case "account":
				return t.accountId === token.accountId;
			default:
				return false;
		}
	});
}
