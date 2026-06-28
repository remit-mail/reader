/**
 * Map the two thread row shapes the app carries (per-mailbox
 * `RemitImapThreadMessageResponse` and the brief/flagged `ThreadRowData`) onto
 * the kit `SearchResult` the mobile search takeover renders.
 */
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { SearchResult, ThreadRowData } from "@remit/ui";
import { formatEmailDate } from "./format.js";

export function threadToSearchResult(
	thread: RemitImapThreadMessageResponse,
): SearchResult {
	return {
		id: thread.messageId,
		sender: thread.fromName ?? thread.fromEmail ?? "Unknown",
		subject: thread.subject ?? "(No subject)",
		snippet: thread.snippet ?? "",
		date: formatEmailDate(thread.sentDate),
		unread: !thread.isRead,
		flagged: thread.hasStars === true,
	};
}

export function rowToSearchResult(row: ThreadRowData): SearchResult {
	return {
		id: row.id,
		sender: row.fromName,
		subject: row.subject,
		snippet: row.snippet,
		date: row.timeLabel,
		unread: !row.isRead,
		flagged: row.starred === true,
	};
}
