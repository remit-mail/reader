/**
 * Daily brief grouping logic.
 *
 * Pure function: takes a flat list of thread message rows and returns the
 * three attention sections defined by the design spec:
 *
 *  1. Needs attention — unread from vip or wellknown senders
 *  2. Flagged        — starred/flagged regardless of read state
 *  3. Everything else — remaining unread + recent read, newest first
 *
 * Sections with no rows are omitted entirely.
 * Muted senders (delivered via per-sender mute on the caller's side) are
 * excluded before this function is called — this function is pure over the
 * rows it receives.
 */

import type {
	RemitImapAccountResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
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
 * Group a flat list of thread row data into the three daily-brief attention
 * sections. Rows should already be filtered for the selected account chip
 * (if any) before calling this function.
 *
 * @param rows      Flat array of ThreadRowData, sorted newest-first.
 * @returns         Array of ThreadSection — empty sections are omitted.
 */
export function groupBriefSections(rows: ThreadRowData[]): ThreadSection[] {
	const attention: ThreadRowData[] = [];
	const flagged: ThreadRowData[] = [];
	const rest: ThreadRowData[] = [];

	const inAttention = new Set<string>();
	const inFlagged = new Set<string>();

	for (const row of rows) {
		if (!row.isRead && (row.trust === "vip" || row.trust === "wellknown")) {
			attention.push(row);
			inAttention.add(row.id);
		}
	}

	for (const row of rows) {
		if (inAttention.has(row.id)) continue;
		if (row.starred) {
			flagged.push(row);
			inFlagged.add(row.id);
		}
	}

	for (const row of rows) {
		if (inAttention.has(row.id) || inFlagged.has(row.id)) continue;
		rest.push(row);
	}

	const sections: ThreadSection[] = [];
	if (attention.length > 0)
		sections.push({
			id: "attention",
			label: "Needs attention",
			threads: attention,
		});
	if (flagged.length > 0)
		sections.push({ id: "flagged", label: "Flagged", threads: flagged });
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
