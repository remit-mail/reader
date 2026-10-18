/**
 * Map the row shapes the app carries onto the kit `SearchResult` the search
 * results render: the per-mailbox `RemitImapThreadMessageResponse` and the
 * brief/flagged `ThreadRowData`.
 */
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { SearchResult, ThreadRowData } from "@remit/ui";
import { formatEmailDate } from "./format.js";
import {
	type ResultFolderIndex,
	resolveResultFolder,
} from "./result-folder.js";

export function threadToSearchResult(
	thread: RemitImapThreadMessageResponse,
	folders?: ResultFolderIndex,
): SearchResult {
	const { folder } = resolveResultFolder(folders, [thread.mailboxId]);
	return {
		id: thread.messageId,
		sender: thread.fromName ?? thread.fromEmail ?? "Unknown",
		...(thread.fromEmail ? { senderEmail: thread.fromEmail } : {}),
		subject: thread.subject ?? "(No subject)",
		snippet: thread.snippet ?? "",
		date: formatEmailDate(thread.sentDate),
		unread: !thread.isRead,
		flagged: thread.hasStars === true,
		threadId: thread.threadId,
		mailboxId: thread.mailboxId,
		...(folder ? { folder } : {}),
	};
}

export function rowToSearchResult(
	row: ThreadRowData,
	folders?: ResultFolderIndex,
): SearchResult {
	const { folder } = resolveResultFolder(
		folders,
		row.mailboxId ? [row.mailboxId] : [],
	);
	return {
		id: row.id,
		sender: row.fromName,
		...(row.fromEmail ? { senderEmail: row.fromEmail } : {}),
		subject: row.subject,
		snippet: row.snippet,
		date: row.timeLabel,
		unread: !row.isRead,
		flagged: row.starred === true,
		...(row.threadId ? { threadId: row.threadId } : {}),
		...(row.mailboxId ? { mailboxId: row.mailboxId } : {}),
		...(folder ? { folder } : {}),
	};
}
