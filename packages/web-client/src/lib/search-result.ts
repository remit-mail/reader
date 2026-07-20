/**
 * Map the row shapes the app carries onto the kit `SearchResult` the search
 * results render. Two feed the literal "Top matches" section (per-mailbox
 * `RemitImapThreadMessageResponse` and the brief/flagged `ThreadRowData`); the
 * third (`RemitImapSemanticSearchResult`) feeds the semantic "Related" section.
 */
import type {
	RemitImapSemanticSearchChunkType,
	RemitImapSemanticSearchResult,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { SearchResult, ThreadRowData } from "@remit/ui";
import { formatEmailDate } from "./format.js";
import {
	type ResultFolderIndex,
	resolveResultFolder,
} from "./result-folder.js";

/**
 * Plain-language label for the `matched: …` chip, so the user understands why
 * a "Related" hit matched (#428). Falls back to the raw chunk type for any
 * value the backend adds later that the client doesn't know about yet.
 */
const MATCHED_CHUNK_LABELS: Record<RemitImapSemanticSearchChunkType, string> = {
	sender: "sender",
	recipient: "recipient",
	subject: "subject",
	attachment: "attachment",
	body: "body",
	entities: "entities",
};

export function matchedChunkLabel(
	chunkType: RemitImapSemanticSearchChunkType,
): string {
	return MATCHED_CHUNK_LABELS[chunkType] ?? chunkType;
}

export function threadToSearchResult(
	thread: RemitImapThreadMessageResponse,
	folders?: ResultFolderIndex,
): SearchResult {
	const { folder } = resolveResultFolder(folders, [thread.mailboxId]);
	return {
		id: thread.messageId,
		sender: thread.fromName ?? thread.fromEmail ?? "Unknown",
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
		subject: row.subject,
		snippet: row.snippet,
		date: row.timeLabel,
		unread: !row.isRead,
		flagged: row.starred === true,
		...(row.mailboxId ? { mailboxId: row.mailboxId } : {}),
		...(folder ? { folder } : {}),
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
	folders?: ResultFolderIndex,
): SearchResult {
	const { mailboxId, folder } = resolveResultFolder(folders, hit.mailboxIds);
	return {
		id: hit.messageId,
		sender: hit.fromName ?? "Unknown",
		subject: hit.subject ?? "(No subject)",
		snippet: "",
		date: hit.sentDate != null ? formatEmailDate(hit.sentDate * 1000) : "",
		threadId: hit.threadId,
		matchedChunkLabel: matchedChunkLabel(hit.matchedChunkType),
		score: hit.score,
		...(mailboxId ? { mailboxId } : {}),
		...(folder ? { folder } : {}),
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
	folders?: ResultFolderIndex,
): SearchResult[] {
	const seenThreadIds = new Set<string>(literalThreadIds);
	const results: SearchResult[] = [];
	for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
		if (seenThreadIds.has(hit.threadId)) continue;
		seenThreadIds.add(hit.threadId);
		results.push(semanticToSearchResult(hit, folders));
	}
	return results;
}
