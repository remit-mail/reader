import {
	mailboxOperationsListMailboxesQueryKey,
	messageBulkOperationsDeleteMessagesMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import {
	cancelThreadListQueries,
	invalidateThreadListQueries,
	patchThreadListQueries,
	restoreThreadListQueries,
	snapshotThreadListQueries,
	type ThreadListSnapshotEntry,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";

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

interface SnapshotEntry<T> {
	queryKey: readonly unknown[];
	data: T;
}

interface DeleteContext {
	threadMessagesPrefix: readonly unknown[];
	listPrefixes: ReadonlyArray<readonly unknown[]>;
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: ThreadListSnapshotEntry[];
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

/**
 * Pure helper: drop soft-deleted rows from a flattened thread list.
 *
 * Belt-and-braces guard against #212. The backend already excludes
 * `isDeleted: true` rows from the inbox listing, but if a regression slips
 * back in (or an eventual-consistency window briefly returns a soft-deleted
 * row) the UI must not show it.
 */
export const dropDeletedThreads = (
	items: RemitImapThreadMessageResponse[],
): RemitImapThreadMessageResponse[] =>
	items.filter((item) => item.isDeleted !== true);

export const useDeleteMessages = ({
	mailboxId,
	threadId,
	accountId,
	onAfterOptimisticRemove,
}: UseDeleteMessagesOptions) => {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const { mutate, isPending } = useMutation({
		...messageBulkOperationsDeleteMessagesMutation(),
		onMutate: async (variables): Promise<DeleteContext> => {
			const messageIds = new Set(variables.body.messageIds ?? []);

			const threadMessagesPrefix = threadId
				? threadDetailOperationsListThreadMessagesQueryKey({
						path: { threadId },
					})
				: [];
			// The browsed mailbox's lists plus the unified cross-account listing
			// that backs the daily brief — deleting from the brief has to remove the
			// row there too, not only from the per-mailbox lists (#140, part of #149).
			const listPrefixes = threadListCacheKeys([mailboxId]);

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesPrefix }),
				cancelThreadListQueries(queryClient, listPrefixes),
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

			const previousThreadsList = snapshotThreadListQueries(
				queryClient,
				listPrefixes,
			);

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

			patchThreadListQueries(queryClient, listPrefixes, (items) =>
				removeMessagesFromItems(items, messageIds),
			);

			onAfterOptimisticRemove?.(Array.from(messageIds));

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
			const count = vars.body.messageIds?.length ?? 0;
			pushError({
				title:
					count > 1
						? `Couldn't delete ${count} messages`
						: "Couldn't delete this message",
				detail: formatErrorDetail(err),
				error: err,
			});
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			if (threadId) {
				queryClient.invalidateQueries({
					queryKey: context.threadMessagesPrefix,
				});
			}
			invalidateThreadListQueries(queryClient, context.listPrefixes);
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
