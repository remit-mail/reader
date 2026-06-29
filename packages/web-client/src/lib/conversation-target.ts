/**
 * The minimal data needed to open a conversation. A list view normally opens the
 * thread it already has loaded, but a semantic "Related" search hit can point at a
 * message that isn't in the loaded list at all. Such a hit still carries its
 * `threadId` and `mailboxId`, and `ConversationView` fetches by `threadId`, so we
 * can open it directly from those alone — no dependency on the loaded list.
 */
import type {
	RemitImapMessageAuthenticity,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";

export interface ConversationTarget {
	threadId: string;
	mailboxId: string;
	subject?: string;
	messageId?: string;
	authenticity?: RemitImapMessageAuthenticity;
}

function threadToConversationTarget(
	thread: RemitImapThreadMessageResponse,
): ConversationTarget {
	return {
		threadId: thread.threadId,
		mailboxId: thread.mailboxId,
		subject: thread.subject,
		messageId: thread.messageId,
		authenticity: thread.authenticity,
	};
}

/**
 * Resolve the conversation to open. Prefer the fully loaded thread (it carries
 * the subject, authenticity and read state the reading pane wants); otherwise
 * fall back to the `threadId` + `mailboxId` carried in the URL by a tapped
 * "Related" hit so a message outside the loaded list still opens.
 */
export function buildConversationTarget(
	selectedThread: RemitImapThreadMessageResponse | undefined,
	fallback: {
		messageId?: string;
		threadId?: string;
		mailboxId?: string;
	},
): ConversationTarget | undefined {
	if (selectedThread) return threadToConversationTarget(selectedThread);
	// Require the messageId too: it's always set alongside the threadId when a
	// result is tapped, and gating on it means clearing `selectedMessageId` (e.g.
	// pressing Back) closes the conversation even if a stale threadId lingers.
	if (fallback.messageId && fallback.threadId && fallback.mailboxId) {
		return {
			threadId: fallback.threadId,
			mailboxId: fallback.mailboxId,
			messageId: fallback.messageId,
		};
	}
	return undefined;
}
