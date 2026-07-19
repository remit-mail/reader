/**
 * Drafts view grouping logic.
 *
 * Pure function: takes Remit outbox drafts and IMAP thread rows and returns
 * two labeled sections:
 *
 *  1. Not yet sent (Remit) — outbox rows with status === "draft" belonging to
 *     the account that owns the open \Drafts mailbox.
 *  2. On the server — IMAP \Drafts thread rows already loaded for the mailbox.
 *
 * Sections with no rows are omitted entirely (mirrors groupBriefSections).
 *
 * --- Dedup note ---
 * Remit draft rows and IMAP \Drafts messages are rendered in both sections
 * without client-side dedup. There is currently no IMAP APPEND-as-draft path
 * and no IMAP uid / Message-ID back-reference on the outbox model, so the two
 * sets are distinct objects with no shared key. If a future change starts
 * appending Remit drafts into IMAP \Drafts the dedup key would be the RFC822
 * `Message-ID` header. Until that ships, rendering both sections faithfully is
 * the correct behaviour (issue #505).
 */

import type {
	RemitImapOutboxMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { ThreadRowData, ThreadSection } from "@remit/ui";
import { formatEmailDate } from "./format.js";

/**
 * Map a Remit outbox draft to the ThreadRowData shape used by remit-ui row
 * components.
 */
export function toDraftRowData(
	draft: RemitImapOutboxMessageResponse,
): ThreadRowData {
	const recipients = draft.toAddresses.join(", ");
	return {
		id: draft.outboxMessageId,
		accountId: draft.accountId,
		fromName: draft.fromName ?? draft.fromAddress ?? "Me",
		fromEmail: draft.fromAddress ?? "",
		subject: draft.subject ?? "(No subject)",
		snippet: recipients ? `To: ${recipients}` : "(No recipients)",
		timeLabel: formatEmailDate(draft.updatedAt),
		isRead: true,
	};
}

/**
 * Map a RemitImapThreadMessageResponse to the ThreadRowData shape used by
 * remit-ui row body components.  Mirrors toThreadRowData in lib/brief.ts.
 */
export function toImapDraftRowData(
	thread: RemitImapThreadMessageResponse,
): ThreadRowData {
	return {
		id: thread.messageId,
		accountId: thread.accountConfigId,
		fromName: thread.fromName ?? thread.fromEmail ?? "Unknown",
		fromEmail: thread.fromEmail ?? "",
		subject: thread.subject ?? "(No subject)",
		snippet: thread.snippet ?? "",
		timeLabel: formatEmailDate(thread.sentDate),
		isRead: thread.isRead,
		hasAttachment: thread.hasAttachment,
		starred: thread.hasStars === true,
	};
}

export interface GroupDraftSectionsInput {
	/** All outbox messages. Will be filtered to status === "draft" and accountId. */
	outboxMessages: RemitImapOutboxMessageResponse[];
	/** The accountId that owns the open \Drafts mailbox. */
	accountId: string;
	/** Thread rows already loaded for the \Drafts mailbox (IMAP). */
	imapThreads: RemitImapThreadMessageResponse[];
}

/**
 * Group outbox drafts and IMAP thread rows into the two-section Drafts view.
 *
 * @param input.outboxMessages  Full outbox list (will be filtered here).
 * @param input.accountId       Owner account of the open \Drafts mailbox.
 * @param input.imapThreads     IMAP \Drafts threads already loaded.
 * @returns                     Array of ThreadSection — empty sections omitted.
 */
export function groupDraftSections({
	outboxMessages,
	accountId,
	imapThreads,
}: GroupDraftSectionsInput): ThreadSection[] {
	// Only outbox rows with status === "draft" for this account. failed/blocked
	// rows live in the Outbox view and must never appear in Drafts (issue #505).
	const remitDrafts = outboxMessages
		.filter((m) => m.status === "draft" && m.accountId === accountId)
		.map(toDraftRowData);

	const imapDrafts = imapThreads.map(toImapDraftRowData);

	const sections: ThreadSection[] = [];

	if (remitDrafts.length > 0) {
		sections.push({
			id: "remit-drafts",
			label: "Not yet sent (Remit)",
			threads: remitDrafts,
		});
	}

	if (imapDrafts.length > 0) {
		sections.push({
			id: "imap-drafts",
			label: "On the server",
			threads: imapDrafts,
		});
	}

	return sections;
}
