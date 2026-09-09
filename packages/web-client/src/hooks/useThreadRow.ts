import { threadDetailOperationsListThreadMessagesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";

const NO_MESSAGES: RemitImapThreadMessageResponse[] = [];

/**
 * The messages a conversation holds, on the key the reading pane already uses.
 *
 * The single owner of `GET /threads/{threadId}/messages` for the client's
 * hooks: everything that needs the conversation resolves off this one cache
 * entry rather than a round trip of its own. A `threadId` of `undefined` asks
 * for nothing.
 */
export const useThreadConversation = (
	threadId: string | undefined,
): RemitImapThreadMessageResponse[] => {
	const { data } = useQuery({
		...threadDetailOperationsListThreadMessagesOptions({
			path: { threadId: threadId ?? "" },
		}),
		enabled: Boolean(threadId),
	});
	return data?.items ?? NO_MESSAGES;
};

/**
 * A thread's own row for the message the reader pointed at.
 *
 * This is how a conversation answers for itself when no list holds it — a
 * cross-folder search hit, or an address pasted into a fresh tab.
 * `GET /threads/{threadId}/messages` returns the same row shape a listing does,
 * `mailboxId` included, so the thread id is the whole address even though the
 * mail is filed in some folder.
 *
 * A thread spans folders — the reader's own reply sits in Sent — so `messageId`
 * picks the row they pointed at. With none, the newest message answers.
 */
export const useThreadRow = (
	threadId: string | undefined,
	messageId: string | undefined,
): RemitImapThreadMessageResponse | undefined => {
	const items = useThreadConversation(threadId);
	const pointedAt = messageId
		? items.find((item) => item.messageId === messageId)
		: undefined;
	const newest = items.length > 0 ? items[items.length - 1] : undefined;
	return pointedAt ?? newest;
};
