/**
 * Daily brief grouping logic.
 *
 * Pure function: takes a flat list of thread message rows and returns one
 * section per message category, in a fixed display order:
 *
 *  1. Flagged       — starred mail, pinned to the top
 *  2. Personal
 *  3. Transactional
 *  4. Newsletter
 *  5. Marketing
 *  6. Social
 *  7. Automated
 *
 * Per-message routing is first-match-wins, and starring always wins over the
 * category:
 *   starred  → Flagged
 *   else     → the section for the row's category
 *
 * A row with no category counts as `personal` (the classifier's own fallback).
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
import { formatEmailDate } from "./format.js";

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
		fromName: thread.fromName ?? thread.fromEmail ?? "Unknown",
		fromEmail: thread.fromEmail ?? "",
		subject: thread.subject ?? "(No subject)",
		snippet: thread.snippet ?? "",
		timeLabel: formatEmailDate(thread.sentDate),
		sentDate: thread.sentDate,
		isRead: thread.isRead,
		hasAttachment: thread.hasAttachment,
		starred:
			thread.star != null && thread.star !== "none" && thread.hasStars === true,
		trust: thread.senderTrust as SenderTrustLevel,
		category: thread.category,
		suspicious,
	};
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
];

/**
 * Group a flat list of thread row data into one section per message category.
 * Rows should already be filtered for the selected account chip (if any) before
 * calling this function.
 *
 * @param rows      Flat array of ThreadRowData, sorted newest-first.
 * @returns         Array of ThreadSection in display order (Flagged first, then
 *                  the category sections) — empty sections are omitted.
 */
export function groupBriefSections(rows: ThreadRowData[]): ThreadSection[] {
	const flagged: ThreadRowData[] = [];
	const byCategory = new Map<string, ThreadRowData[]>(
		CATEGORY_SECTIONS.map((s) => [s.category, []]),
	);

	for (const row of rows) {
		if (row.starred) {
			flagged.push(row);
			continue;
		}
		const category = row.category ?? MessageCategory.personal;
		const bucket =
			byCategory.get(category) ?? byCategory.get(MessageCategory.personal);
		bucket?.push(row);
	}

	const sections: ThreadSection[] = [];
	if (flagged.length > 0)
		sections.push({ id: "flagged", label: "Flagged", threads: flagged });
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
