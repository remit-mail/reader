import { threadDetailOperationsListThreadMessagesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";

/**
 * A thread's own row for the message the reader pointed at.
 *
 * This is how a conversation answers for itself when no list holds it — a
 * cross-folder search hit, or an address pasted into a fresh tab.
 * `GET /threads/{threadId}/messages` returns the same row shape a listing does,
 * `mailboxId` included, so the thread id is the whole address even though the
 * mail is filed in some folder. The reading pane already makes that request, so
 * this resolves off the same cache entry rather than a round trip of its own.
 *
 * A thread spans folders — the reader's own reply sits in Sent — so `messageId`
 * picks the row they pointed at. With none, the newest message answers.
 */
export const useThreadRow = (
	threadId: string | undefined,
	messageId: string | undefined,
): RemitImapThreadMessageResponse | undefined => {
	const { data } = useQuery({
		...threadDetailOperationsListThreadMessagesOptions({
			path: { threadId: threadId ?? "" },
		}),
		enabled: Boolean(threadId),
	});

	const items = data?.items ?? [];
	const pointedAt = messageId
		? items.find((item) => item.messageId === messageId)
		: undefined;
	const newest = items.length > 0 ? items[items.length - 1] : undefined;
	return pointedAt ?? newest;
};
