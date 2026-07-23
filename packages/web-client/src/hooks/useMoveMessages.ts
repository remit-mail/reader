import {
	mailboxOperationsListMailboxesQueryKey,
	messageBulkOperationsMoveMessagesMutation,
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

interface UseMoveMessagesOptions {
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

interface MoveContext {
	threadMessagesPrefix: readonly unknown[];
	listPrefixes: ReadonlyArray<readonly unknown[]>;
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: ThreadListSnapshotEntry[];
}

/**
 * Pure helper: drop the messages in `messageIds` from a single page's items.
 *
 * Mirrors `removeMessagesFromItems` in `useDeleteMessages` so the optimistic
 * patcher can be unit-tested without rendering React. The move flow needs the
 * same surface — rows leave the source view immediately and only restore on
 * server failure.
 */
export const removeMovedMessagesFromItems = (
	items: RemitImapThreadMessageResponse[],
	messageIds: Set<string>,
): RemitImapThreadMessageResponse[] =>
	items.filter((item) => !messageIds.has(item.messageId));

export const useMoveMessages = ({
	mailboxId,
	threadId,
	accountId,
	onAfterOptimisticRemove,
}: UseMoveMessagesOptions) => {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const { mutate, isPending } = useMutation({
		...messageBulkOperationsMoveMessagesMutation(),
		onMutate: async (variables): Promise<MoveContext> => {
			const messageIds = new Set(variables.body.messageIds ?? []);

			const threadMessagesPrefix = threadId
				? threadDetailOperationsListThreadMessagesQueryKey({
						path: { threadId },
					})
				: [];
			// The source and destination mailboxes' lists plus the unified
			// cross-account listing that backs the daily brief — moving from the
			// brief has to remove the row there too, not only from the per-mailbox
			// lists (#140, part of #149).
			const listPrefixes = threadListCacheKeys([
				mailboxId,
				variables.body.destinationMailboxId,
			]);

			// Only cancel the thread-messages query when we actually have a
			// threadId — passing an empty queryKey here would match every
			// query in the cache and cancel unrelated work (Copilot review,
			// PR #287). The list prefixes are always scoped so they're safe.
			await Promise.all([
				...(threadId
					? [queryClient.cancelQueries({ queryKey: threadMessagesPrefix })]
					: []),
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
							items: removeMovedMessagesFromItems(old.items, messageIds),
						};
					},
				);
			}

			patchThreadListQueries(queryClient, listPrefixes, (items) =>
				removeMovedMessagesFromItems(items, messageIds),
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
						? `Couldn't move ${count} messages`
						: "Couldn't move this message",
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

	const moveMessages = useCallback(
		(messageIds: string[], destinationMailboxId: string) => {
			if (messageIds.length === 0) return;
			mutate({ body: { messageIds, destinationMailboxId } });
		},
		[mutate],
	);

	return { moveMessages, isPending };
};
