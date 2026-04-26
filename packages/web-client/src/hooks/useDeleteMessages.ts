import {
	mailboxOperationsListMailboxesQueryKey,
	messageBulkOperationsDeleteMessagesMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

interface UseDeleteMessagesOptions {
	mailboxId: string;
	threadId?: string;
	accountId?: string;
	/**
	 * Called once the optimistic removal has been applied. Use this to
	 * navigate away from a now-empty thread (e.g. clear `selectedMessageId`)
	 * before the server response arrives.
	 */
	onAfterOptimisticRemove?: (messageIds: string[]) => void;
}

interface ThreadMessagesData {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

interface ThreadsListPage {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

interface ThreadsListData {
	pages: ThreadsListPage[];
	pageParams: Array<string | undefined>;
}

interface SnapshotEntry<T> {
	queryKey: readonly unknown[];
	data: T;
}

interface DeleteContext {
	threadMessagesPrefix: readonly unknown[];
	threadsListPrefix: readonly unknown[];
	threadsSearchPrefix: readonly unknown[];
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: SnapshotEntry<ThreadsListData>[];
}

/**
 * Pure helper: drop the messages in `messageIds` from a single page's items.
 *
 * Exported so the optimistic-removal math can be exercised without rendering
 * React. Other identity is preserved — only items whose `messageId` is in
 * the set are removed.
 */
export const removeMessagesFromItems = (
	items: RemitImapThreadMessageResponse[],
	messageIds: Set<string>,
): RemitImapThreadMessageResponse[] =>
	items.filter((item) => !messageIds.has(item.messageId));

export const useDeleteMessages = ({
	mailboxId,
	threadId,
	accountId,
	onAfterOptimisticRemove,
}: UseDeleteMessagesOptions) => {
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		...messageBulkOperationsDeleteMessagesMutation(),
		onMutate: async (variables): Promise<DeleteContext> => {
			const messageIds = new Set(variables.body.messageIds ?? []);

			const threadMessagesPrefix = threadId
				? threadDetailOperationsListThreadMessagesQueryKey({
						path: { threadId },
					})
				: [];
			const threadsListPrefix = threadOperationsListThreadsQueryKey({
				path: { mailboxId },
			});
			const threadsSearchPrefix = threadOperationsSearchThreadsQueryKey({
				path: { mailboxId },
			});

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesPrefix }),
				queryClient.cancelQueries({ queryKey: threadsListPrefix }),
				queryClient.cancelQueries({ queryKey: threadsSearchPrefix }),
			]);

			const previousThreadMessages = threadId
				? queryClient
						.getQueriesData<ThreadMessagesData>({
							queryKey: threadMessagesPrefix,
						})
						.filter(
							(entry): entry is [readonly unknown[], ThreadMessagesData] =>
								entry[1] !== undefined,
						)
						.map(([queryKey, data]) => ({ queryKey, data }))
				: [];

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

			if (threadId) {
				queryClient.setQueriesData<ThreadMessagesData>(
					{ queryKey: threadMessagesPrefix },
					(old) => {
						if (!old) return old;
						return {
							...old,
							items: removeMessagesFromItems(old.items, messageIds),
						};
					},
				);
			}

			const patchListData = (old: ThreadsListData | undefined) => {
				if (!old) return old;
				return {
					...old,
					pages: old.pages.map((page) => ({
						...page,
						items: removeMessagesFromItems(page.items, messageIds),
					})),
				};
			};

			queryClient.setQueriesData<ThreadsListData>(
				{ queryKey: threadsListPrefix },
				patchListData,
			);
			queryClient.setQueriesData<ThreadsListData>(
				{ queryKey: threadsSearchPrefix },
				patchListData,
			);

			onAfterOptimisticRemove?.(Array.from(messageIds));

			return {
				threadMessagesPrefix,
				threadsListPrefix,
				threadsSearchPrefix,
				previousThreadMessages,
				previousThreadsList,
			};
		},
		onError: (_err, _vars, context) => {
			if (!context) return;
			for (const entry of context.previousThreadMessages) {
				queryClient.setQueryData(entry.queryKey, entry.data);
			}
			for (const entry of context.previousThreadsList) {
				queryClient.setQueryData(entry.queryKey, entry.data);
			}
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			if (threadId) {
				queryClient.invalidateQueries({
					queryKey: context.threadMessagesPrefix,
				});
			}
			queryClient.invalidateQueries({ queryKey: context.threadsListPrefix });
			queryClient.invalidateQueries({ queryKey: context.threadsSearchPrefix });
			if (accountId) {
				queryClient.invalidateQueries({
					queryKey: mailboxOperationsListMailboxesQueryKey({
						path: { accountId },
					}),
				});
			}
		},
	});

	const deleteMessages = useCallback(
		(messageIds: string[]) => {
			if (messageIds.length === 0) return;
			mutate({ body: { messageIds } });
		},
		[mutate],
	);

	return { deleteMessages, isPending };
};
