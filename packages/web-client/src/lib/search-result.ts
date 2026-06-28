/**
 * Map the row shapes the app carries onto the kit `SearchResult` the search
 * results render. Two feed the literal "Top matches" section (per-mailbox
 * `RemitImapThreadMessageResponse` and the brief/flagged `ThreadRowData`); the
 * third (`RemitImapSemanticSearchResult`) feeds the semantic "Related" section.
 */
import type {
	RemitImapSemanticSearchResult,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
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

/**
 * Map a semantic hit onto a `SearchResult`. Display fields are denormalized at
 * index time and absent for older entries, so each falls back. Read/star state
 * isn't carried by the semantic index, so the row renders neutral. `sentDate` is
 * epoch seconds; `formatEmailDate` takes epoch ms.
 */
export function semanticToSearchResult(
	hit: RemitImapSemanticSearchResult,
): SearchResult {
	return {
		id: hit.messageId,
		sender: hit.fromName ?? "Unknown",
		subject: hit.subject ?? "(No subject)",
		snippet: "",
		date: hit.sentDate != null ? formatEmailDate(hit.sentDate * 1000) : "",
	};
}

/**
 * Build the semantic "Related" section: order by score (most relevant first),
 * collapse to one row per thread, and drop any thread already shown under the
 * literal "Top matches" — literal precedence, so a thread never appears twice.
 */
export function relatedSearchResults(
	hits: RemitImapSemanticSearchResult[],
	literalThreadIds: Iterable<string>,
): SearchResult[] {
	const seenThreadIds = new Set<string>(literalThreadIds);
	const results: SearchResult[] = [];
	for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
		if (seenThreadIds.has(hit.threadId)) continue;
		seenThreadIds.add(hit.threadId);
		results.push(semanticToSearchResult(hit));
	}
	return results;
}
