import { threadDetailOperationsListThreadMessagesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapStarColor,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";

/**
 * The star colour of the message a reading pane has open.
 *
 * Read from the conversation itself, on the key `ConversationView` already
 * holds — one request between them, and the toolbar and the message row cannot
 * disagree. A list row is a copy that stops being refreshed the moment the mail
 * no longer matches the browsed predicate, so it answers only until the
 * conversation does (#602).
 *
 * For a pane with no conversation open — the keyboard cursor walking a list —
 * pass nothing and act on the row's own value.
 */
export const useMessageStar = (
	thread: RemitImapThreadMessageResponse | undefined,
): RemitImapStarColor | undefined => {
	const { data } = useQuery({
		...threadDetailOperationsListThreadMessagesOptions({
			path: { threadId: thread?.threadId ?? "" },
		}),
		enabled: Boolean(thread?.threadId),
	});

	const openMessage = data?.items.find(
		(message) => message.messageId === thread?.messageId,
	);
	return openMessage?.star ?? thread?.star;
};
