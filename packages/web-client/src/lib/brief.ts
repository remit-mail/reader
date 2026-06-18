/**
 * Daily brief grouping logic.
 *
 * Pure function: takes a flat list of thread message rows and returns the
 * brief's attention sections in display order:
 *
 *  1. Needs attention — personal/transactional mail, or mail from a vip/wellknown
 *                       sender, regardless of read state
 *  2. Flagged         — starred mail, regardless of read state or category
 *  3. Daily brief     — newsletters, marketing, and social mail, grouped
 *                       into a digest section so it never drowns out personal
 *                       mail in the main scroll
 *  4. Everything else — remaining mail not captured above
 *
 * Per-message routing follows first-match-wins precedence:
 *   starred                                          → Flagged
 *   category ∈ {newsletter, marketing, social}       → Daily brief
 *   category ∈ {personal, transactional}
 *     OR trust ∈ {vip, wellknown}                    → Needs attention
 *   otherwise                                         → Everything else
 *
 * The category split runs BEFORE the trust check, so a newsletter from a
 * wellknown sender lands in the digest rather than "Needs attention". Starred
 * always wins, so a user-starred newsletter is always surfaced in Flagged.
 *
 * Read state is intentionally not a routing signal: in a high-volume mailbox,
 * read≠handled and unread≠important. Unread is a user-selectable filter chip.
 *
 * Missing category is treated as `personal` (the classifier's own fallback).
 * Muted senders (filtered by the caller) and empty sections are excluded.
 */

import type {
	RemitImapAccountResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { MessageCategory } from "@remit/domain-enums";
import type {
	AccountChip,
	SenderTrustLevel,
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
 * Categories that belong in the "Daily brief" digest section. These are
 * subscription / bulk-sender categories that the user expects in a digest
 * rather than mixed into personal mail.
 */
const BRIEF_CATEGORIES: ReadonlySet<string> = new Set([
	MessageCategory.newsletter,
	MessageCategory.marketing,
	MessageCategory.social,
]);

/**
 * Categories that qualify unread mail for "Needs attention" — personal
 * conversation and transactional mail the user likely needs to act on.
 */
const ATTENTION_CATEGORIES: ReadonlySet<string> = new Set([
	MessageCategory.personal,
	MessageCategory.transactional,
]);

/**
 * Group a flat list of thread row data into the daily-brief sections. Rows
 * should already be filtered for the selected account chip (if any) before
 * calling this function.
 *
 * @param rows      Flat array of ThreadRowData, sorted newest-first.
 * @returns         Array of ThreadSection in display order — empty sections
 *                  are omitted.
 */
export function groupBriefSections(rows: ThreadRowData[]): ThreadSection[] {
	const attention: ThreadRowData[] = [];
	const flagged: ThreadRowData[] = [];
	const brief: ThreadRowData[] = [];
	const rest: ThreadRowData[] = [];

	for (const row of rows) {
		// 1. Starred → Flagged (highest priority)
		if (row.starred) {
			flagged.push(row);
			continue;
		}

		// 2. Digest categories → Daily brief (before any trust check)
		if (row.category != null && BRIEF_CATEGORIES.has(row.category)) {
			brief.push(row);
			continue;
		}

		// 3. Personal/transactional category, or a trusted sender — regardless of read state
		if (
			ATTENTION_CATEGORIES.has(row.category ?? MessageCategory.personal) ||
			row.trust === "vip" ||
			row.trust === "wellknown"
		) {
			attention.push(row);
			continue;
		}

		// 4. Everything else
		rest.push(row);
	}

	// Display order: Needs attention, Flagged, Daily brief, Everything else
	const sections: ThreadSection[] = [];
	if (attention.length > 0)
		sections.push({
			id: "attention",
			label: "Needs attention",
			threads: attention,
		});
	if (flagged.length > 0)
		sections.push({ id: "flagged", label: "Flagged", threads: flagged });
	if (brief.length > 0)
		sections.push({ id: "brief", label: "Daily brief", threads: brief });
	if (rest.length > 0)
		sections.push({ id: "rest", label: "Everything else", threads: rest });
	return sections;
}

/**
 * Build account chip array from accounts list + loaded unseen counts.
 * Muted accounts are excluded from the chip row.
 *
 * @param accounts       All non-muted account configs.
 * @param unseenByAccount  Map from accountId to its unread count.
 * @param activeAccountId  Currently selected chip id (undefined = "All").
 */
export function buildBriefChips(
	accounts: RemitImapAccountResponse[],
	unseenByAccount: Map<string, number>,
	activeAccountId: string | undefined,
): AccountChip[] {
	const nonMuted = accounts.filter((a) => !a.muted?.value);
	const chips: AccountChip[] = [
		{ id: "all", label: "All", active: activeAccountId === undefined },
	];
	for (const account of nonMuted) {
		chips.push({
			id: account.accountId,
			label: account.email.split("@")[0] ?? account.email,
			count: unseenByAccount.get(account.accountId),
			active: activeAccountId === account.accountId,
		});
	}
	return chips;
}

/**
 * Count muted accounts (excluded from brief chips, shown as "+N muted").
 */
export function countMutedAccounts(
	accounts: RemitImapAccountResponse[],
): number {
	return accounts.filter((a) => a.muted?.value).length;
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
