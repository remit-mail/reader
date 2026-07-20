import {
	messageOperationsUpdateMessageFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
	unifiedThreadOperationsListAllThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { patchThreadListCache, type ThreadListCache } from "@/lib/thread-cache";

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

/**
 * Either shape a thread list/search query caches — the infinite mailbox list
 * or a single-shot page. `setQueriesData` matches by key prefix, so the
 * optimistic updater sees both.
 */
type ThreadsListData = ThreadListCache;

interface SnapshotEntry<T> {
	queryKey: readonly unknown[];
	data: T;
}

interface ToggleStarContext {
	threadMessagesPrefix: readonly unknown[];
	threadsListPrefix: readonly unknown[];
	threadsSearchPrefix: readonly unknown[];
	unifiedThreadsPrefix: readonly unknown[];
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: SnapshotEntry<ThreadsListData>[];
	previousUnifiedThreads: SnapshotEntry<ThreadMessagesData>[];
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
			const affectedMailboxId = resolveMailboxForMessage(
				messageId,
				messages,
				mailboxId,
			);
			const threadsListPrefix = threadOperationsListThreadsQueryKey({
				path: { mailboxId: affectedMailboxId },
			});
			const threadsSearchPrefix = threadOperationsSearchThreadsQueryKey({
				path: { mailboxId: affectedMailboxId },
			});
			// The unified cross-account listing backs the daily brief and the
			// Starred mailbox, so a star toggled from an inbox has to land there
			// too — without this the starred view keeps serving a stale page for
			// its whole staleTime and the message never appears.
			const unifiedThreadsPrefix =
				unifiedThreadOperationsListAllThreadsQueryKey();

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesPrefix }),
				queryClient.cancelQueries({ queryKey: threadsListPrefix }),
				queryClient.cancelQueries({ queryKey: threadsSearchPrefix }),
				queryClient.cancelQueries({ queryKey: unifiedThreadsPrefix }),
			]);

			const previousThreadMessages = queryClient
				.getQueriesData<ThreadMessagesData>({ queryKey: threadMessagesPrefix })
				.filter(
					(entry): entry is [readonly unknown[], ThreadMessagesData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			const previousThreadsList = queryClient
				.getQueriesData<ThreadsListData>({ queryKey: threadsListPrefix })
				.concat(
					queryClient.getQueriesData<ThreadsListData>({
						queryKey: threadsSearchPrefix,
					}),
				)
				.filter(
					(entry): entry is [readonly unknown[], ThreadsListData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			const previousUnifiedThreads = queryClient
				.getQueriesData<ThreadMessagesData>({ queryKey: unifiedThreadsPrefix })
				.filter(
					(entry): entry is [readonly unknown[], ThreadMessagesData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			// The unified-threads prefix carries both shapes too: the Flagged view
			// runs an infinite query on `listAllThreads({ starred: true })`, which
			// sits under the same prefix as the single-shot readers. Patching it as
			// a plain `{ items }` threw on that entry and failed the star before it
			// was sent — the same defect as the mailbox list (issues #51, #55), so
			// it goes through the same helper.
			const patchItemsData = (old: unknown) =>
				patchThreadListCache(old, (items) =>
					toggleStarsInItems(items, messageId, nextStarred),
				);

			queryClient.setQueriesData(
				{ queryKey: threadMessagesPrefix },
				patchItemsData,
			);
			queryClient.setQueriesData(
				{ queryKey: unifiedThreadsPrefix },
				patchItemsData,
			);

			const patchListData = (old: unknown) =>
				patchThreadListCache(old, (items) =>
					toggleStarsInItems(items, messageId, nextStarred),
				);

			queryClient.setQueriesData(
				{ queryKey: threadsListPrefix },
				patchListData,
			);
			queryClient.setQueriesData(
				{ queryKey: threadsSearchPrefix },
				patchListData,
			);

			return {
				threadMessagesPrefix,
				threadsListPrefix,
				threadsSearchPrefix,
				unifiedThreadsPrefix,
				previousThreadMessages,
				previousThreadsList,
				previousUnifiedThreads,
			};
		},
		onError: (err, vars, context) => {
			if (context) {
				for (const entry of context.previousThreadMessages) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
				for (const entry of context.previousThreadsList) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
				for (const entry of context.previousUnifiedThreads) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
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
			queryClient.invalidateQueries({ queryKey: context.threadsListPrefix });
			queryClient.invalidateQueries({ queryKey: context.threadsSearchPrefix });
			queryClient.invalidateQueries({ queryKey: context.unifiedThreadsPrefix });
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
