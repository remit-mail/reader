import { threadDetailOperationsListThreadMessagesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Every message id in a thread, read from the cached thread-messages listing.
 *
 * A toolbar verb acts on the whole conversation, not the one row that
 * represents it in a list. When the conversation has not been opened yet its
 * messages are not cached, and the representative message id is the best the
 * caller can do.
 */
export const useThreadMessageIds = (): ((
	thread: RemitImapThreadMessageResponse,
) => string[]) => {
	const queryClient = useQueryClient();
	return useCallback(
		(thread: RemitImapThreadMessageResponse) => {
			const threadKey = threadDetailOperationsListThreadMessagesQueryKey({
				path: { threadId: thread.threadId },
			});
			const cached = queryClient.getQueriesData<{
				items: { messageId: string }[];
			}>({ queryKey: threadKey });
			const ids = cached.flatMap(
				([, data]) => data?.items.map((m) => m.messageId) ?? [],
			);
			return ids.length > 0 ? ids : [thread.messageId];
		},
		[queryClient],
	);
};
