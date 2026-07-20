/**
 * Daily brief grouping logic.
 *
 * Pure function: takes a flat list of thread message rows and returns one
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
 * Each row lands in the section for its category; a row with no category counts
 * as `uncategorized`, which is its own section rather than being folded into
 * Personal — unclassified mail is missing work, not a decision (issue #45).
 * Starred mail is not a section —
 * the star is a per-row marker, so a starred message stays in its category.
 *
 * Sender trust (vip/wellknown) no longer sections the brief — the signal is
 * still carried on each row (see `toThreadRowData`) for future use, but it does
 * not decide where a row lands. Read state is likewise not a routing signal: in
 * a high-volume mailbox read≠handled and unread≠important; unread is a
 * user-selectable filter chip instead.
 *
 * Muted senders (filtered by the caller) and empty sections are excluded.
 */

import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { MessageCategory } from "@remit/domain-enums";
import type {
	SenderTrustLevel,
	ThreadCategory,
	ThreadRowData,
	ThreadSection,
} from "@remit/ui";
import { toDisplayCategory } from "./display-category.js";
import { formatEmailDate } from "./format.js";
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
		accountId: thread.accountId ?? thread.accountConfigId,
		mailboxId: thread.mailboxId,
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
	};
}

/**
 * Union of the brief's own rows with the rows the server's cross-folder search
 * returned, newest first.
 *
 * Both lists are needed. The server matches subject and From only, so a row
 * whose snippet carries the term is found only by the client-side pass over the
 * loaded brief rows; the server pass is the only one that reaches Archive,
 * Sent, Spam and custom folders, which the brief list never loads. The two
 * overlap on INBOX, so rows are deduped by id, the first occurrence winning.
 *
 * Rows without a `sentDate` sort last; the brief's own list is already newest
 * first, so this only has to re-interleave the two sources.
 */
export function mergeSearchRows(
	briefRows: ThreadRowData[],
	searchRows: ThreadRowData[],
): ThreadRowData[] {
	const seen = new Set<string>();
	const merged: ThreadRowData[] = [];
	for (const row of [...briefRows, ...searchRows]) {
		if (seen.has(row.id)) continue;
		seen.add(row.id);
		merged.push(row);
	}
	return merged.sort((a, b) => (b.sentDate ?? 0) - (a.sentDate ?? 0));
}

/**
 * Category sections in fixed display order. The `id`/`label` drive the rendered
 * section; `category` is the row category that routes into it.
 */
const CATEGORY_SECTIONS: ReadonlyArray<{
	id: string;
	label: string;
	category: ThreadCategory;
}> = [
	{ id: "personal", label: "Personal", category: MessageCategory.personal },
	{
		id: "transactional",
		label: "Transactional",
		category: MessageCategory.transactional,
	},
	{
		id: "newsletter",
		label: "Newsletter",
		category: MessageCategory.newsletter,
	},
	{ id: "marketing", label: "Marketing", category: MessageCategory.marketing },
	{ id: "social", label: "Social", category: MessageCategory.social },
	{ id: "automated", label: "Automated", category: MessageCategory.automated },
	{
		id: "uncategorized",
		label: "Unclassified",
		category: MessageCategory.uncategorized,
	},
];

/**
 * Group a flat list of thread row data into one section per message category.
 * Rows should already be filtered for the selected account chip (if any) before
 * calling this function.
 *
 * @param rows      Flat array of ThreadRowData, sorted newest-first.
 * @returns         Array of ThreadSection in category display order — empty
 *                  sections are omitted.
 */
export function groupBriefSections(rows: ThreadRowData[]): ThreadSection[] {
	const byCategory = new Map<string, ThreadRowData[]>(
		CATEGORY_SECTIONS.map((s) => [s.category, []]),
	);

	for (const row of rows) {
		const category = row.category ?? MessageCategory.uncategorized;
		const bucket =
			byCategory.get(category) ?? byCategory.get(MessageCategory.uncategorized);
		bucket?.push(row);
	}

	const sections: ThreadSection[] = [];
	for (const section of CATEGORY_SECTIONS) {
		const threads = byCategory.get(section.category);
		if (threads && threads.length > 0)
			sections.push({
				id: section.id,
				label: section.label,
				threads,
			});
	}
	return sections;
}

/**
 * Returns true when `t` matches the free-text `query` (lower-cased).
 * Checked against fromName, fromEmail, subject, and snippet.
 */
export function matchesBriefSearch(t: ThreadRowData, query: string): boolean {
	return (
		t.fromName.toLowerCase().includes(query) ||
		t.fromEmail.toLowerCase().includes(query) ||
		t.subject.toLowerCase().includes(query) ||
		t.snippet.toLowerCase().includes(query)
	);
}

/**
 * Returns true when `t` satisfies every parsed filter token — the client-side
 * counterpart of the params `threadOperationsSearchThreads` accepts, applied
 * over the already-loaded brief/flagged rows (#428). A row without the data a
 * token needs (e.g. no `sentDate` for `before:`/`after:`) never matches that
 * token, so it drops out rather than showing under an unverifiable filter.
 * `in:`/`account:` have no server param at all — this is the entire
 * implementation of both, reusing the same per-account fan-out the daily
 * brief already reads its rows from (`accountId`/`mailboxId` are already on
 * every row).
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
			case "hasAttachment":
				return t.hasAttachment === true;
			case "isUnread":
				return !t.isRead;
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
