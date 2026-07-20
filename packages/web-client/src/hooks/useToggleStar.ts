import {
	messageOperationsUpdateMessageFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { patchThreadListCache } from "@/lib/thread-cache";
import {
	cancelThreadListQueries,
	invalidateThreadListQueries,
	patchThreadListQueries,
	restoreThreadListQueries,
	snapshotThreadListQueries,
	type ThreadListSnapshotEntry,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";

interface UseToggleStarOptions {
	threadId: string;
	/**
	 * The mailbox whose lists to patch when the starred message is not in
	 * `messages` — the browsed mailbox, which is where a list row lives.
	 */
	mailboxId: string;
	/**
	 * The thread's messages, when the caller has them. A conversation spans
	 * mailboxes (#46), so the lists to patch are the ones for the mailbox the
	 * starred message is actually in, not the one being browsed.
	 */
	messages?: RemitImapThreadMessageResponse[];
}

/**
 * The mailbox whose cached listings a mutation on `messageId` affects.
 *
 * The message's own mailbox, falling back to the browsed one when the thread's
 * messages are unknown or do not contain it. Starring a reply in Sent from a
 * conversation opened in INBOX has to patch Sent's lists; INBOX's do not hold
 * that message and patching them changes nothing.
 */
export const resolveMailboxForMessage = (
	messageId: string,
	messages: RemitImapThreadMessageResponse[] | undefined,
	fallbackMailboxId: string,
): string =>
	messages?.find((message) => message.messageId === messageId)?.mailboxId ??
	fallbackMailboxId;

interface ThreadMessagesData {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

interface SnapshotEntry<T> {
	queryKey: readonly unknown[];
	data: T;
}

interface ToggleStarContext {
	threadMessagesPrefix: readonly unknown[];
	listPrefixes: ReadonlyArray<readonly unknown[]>;
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: ThreadListSnapshotEntry[];
}

export const toggleStarsInItems = (
	items: RemitImapThreadMessageResponse[],
	messageId: string,
	nextStarred: boolean,
): RemitImapThreadMessageResponse[] =>
	items.map((item) =>
		item.messageId === messageId ? { ...item, hasStars: nextStarred } : item,
	);

export const useToggleStar = ({
	threadId,
	mailboxId,
	messages,
}: UseToggleStarOptions) => {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const { mutate, isPending, variables } = useMutation({
		...messageOperationsUpdateMessageFlagsMutation(),
		onMutate: async (vars): Promise<ToggleStarContext> => {
			const messageId = vars.path.messageId;
			const nextStarred = vars.body.isStarred ?? false;

			// Use partial-key prefixes so the cancel/snapshot/patch covers the
			// full key (which includes query options like { order: "desc",
			// mailboxId }) without us having to enumerate every variant. React
			// Query matches by prefix on the first key element.
			const threadMessagesPrefix =
				threadDetailOperationsListThreadMessagesQueryKey({
					path: { threadId },
				});
			// The list caches to patch: the message's own mailbox plus the unified
			// cross-account listing that backs the daily brief and the Flagged view.
			// Resolved from the shared source so this hook can never fall behind the
			// others on which listings exist (#149).
			const listPrefixes = threadListCacheKeys([
				resolveMailboxForMessage(messageId, messages, mailboxId),
			]);

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesPrefix }),
				cancelThreadListQueries(queryClient, listPrefixes),
			]);

			const previousThreadMessages = queryClient
				.getQueriesData<ThreadMessagesData>({ queryKey: threadMessagesPrefix })
				.filter(
					(entry): entry is [readonly unknown[], ThreadMessagesData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			const previousThreadsList = snapshotThreadListQueries(
				queryClient,
				listPrefixes,
			);

			// The thread-detail cache carries the `{ items }` shape too, so it goes
			// through the same shape-tolerant helper as the listings.
			queryClient.setQueriesData({ queryKey: threadMessagesPrefix }, (old) =>
				patchThreadListCache(old, (items) =>
					toggleStarsInItems(items, messageId, nextStarred),
				),
			);
			patchThreadListQueries(queryClient, listPrefixes, (items) =>
				toggleStarsInItems(items, messageId, nextStarred),
			);

			return {
				threadMessagesPrefix,
				listPrefixes,
				previousThreadMessages,
				previousThreadsList,
			};
		},
		onError: (err, vars, context) => {
			if (context) {
				for (const entry of context.previousThreadMessages) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
				restoreThreadListQueries(queryClient, context.previousThreadsList);
			}
			const nextStarred = vars.body.isStarred ?? false;
			pushError({
				title: nextStarred
					? "Couldn't star message"
					: "Couldn't unstar message",
				detail: formatErrorDetail(err),
				error: err,
			});
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			queryClient.invalidateQueries({ queryKey: context.threadMessagesPrefix });
			invalidateThreadListQueries(queryClient, context.listPrefixes);
		},
	});

	const toggleStar = (messageId: string, currentlyStarred: boolean) => {
		mutate({
			path: { messageId },
			body: {
				isStarred: !currentlyStarred,
			},
		});
	};

	return {
		toggleStar,
		isPending,
		pendingMessageId: isPending ? variables?.path.messageId : undefined,
	};
};
