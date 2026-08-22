import {
	mailboxOperationsListMailboxesQueryKey,
	messageBulkOperationsDeleteMessagesMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useRoleAppointmentPrompt } from "@/components/mail/RoleAppointmentPromptProvider";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { isFolderRoleRefusal } from "@/components/ui/folder-role-refusal";
import { resolveMailboxesForMessages } from "@/hooks/useMarkAsRead";
import { runChunkedMutation } from "@/lib/bulk-actions";
import {
	cancelThreadListQueries,
	invalidateThreadListQueries,
	patchThreadListQueries,
	restoreThreadListQueries,
	snapshotThreadListQueries,
	type ThreadMessagesData,
	type ThreadMutationContext,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";

interface UseDeleteMessagesOptions {
	mailboxId: string;
	threadId?: string;
	accountId?: string;
	/**
	 * The threads the ids may come from, when the caller has them. A selection in
	 * the brief or Flagged spans mailboxes and accounts, so the listings to patch
	 * are the ones each message actually lives in — `mailboxId` alone would leave
	 * every other mailbox's cached list holding a deleted row.
	 */
	messages?: RemitImapThreadMessageResponse[];
	/**
	 * Called once the optimistic removal has been applied. Use this to
	 * navigate away from a now-empty thread (e.g. clear `selectedMessageId`)
	 * before the server response arrives.
	 */
	onAfterOptimisticRemove?: (messageIds: string[]) => void;
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
	messages,
	onAfterOptimisticRemove,
}: UseDeleteMessagesOptions) => {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();
	const { requestAppointment } = useRoleAppointmentPrompt();

	// The refused chunk is not what the user asked for. The whole selection is
	// held here so the appointment's confirm replays all of it (#887).
	const selectionRef = useRef<string[]>([]);
	const runRef = useRef<(messageIds: string[]) => Promise<void>>(
		async () => {},
	);

	const { mutateAsync, isPending } = useMutation({
		...messageBulkOperationsDeleteMessagesMutation(),
		onMutate: async (variables): Promise<ThreadMutationContext> => {
			const messageIds = new Set(variables.body.messageIds ?? []);

			const threadMessagesPrefix = threadId
				? threadDetailOperationsListThreadMessagesQueryKey({
						path: { threadId },
					})
				: [];
			// Every mailbox the deleted messages live in, plus the unified
			// cross-account listing that backs the daily brief — deleting from the
			// brief has to remove the row there too, not only from the per-mailbox
			// lists (#140, part of #149).
			const listPrefixes = threadListCacheKeys(
				resolveMailboxesForMessages(messageIds, messages ?? [], mailboxId),
			);

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
			// A provenance refusal is answered by the prompt, not by a banner: the
			// generic banner is suppressed for this one error, and every other
			// failure keeps today's.
			const refusal = isFolderRoleRefusal(err);
			if (refusal) {
				const replay = selectionRef.current;
				requestAppointment({
					accountId: refusal.accountId,
					role: refusal.role,
					reason: refusal.reason,
					action: { kind: "delete", count: replay.length },
					onAppointed: () => runRef.current(replay),
				});
				return;
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

	const runSelection = useCallback(
		(messageIds: string[]): Promise<void> =>
			runChunkedMutation(messageIds, (chunk) =>
				mutateAsync({ body: { messageIds: chunk } }),
			),
		[mutateAsync],
	);

	useEffect(() => {
		runRef.current = runSelection;
	}, [runSelection]);

	const deleteMessages = useCallback(
		(messageIds: string[]) => {
			if (messageIds.length === 0) return;
			selectionRef.current = messageIds;
			void runSelection(messageIds);
		},
		[runSelection],
	);

	return { deleteMessages, isPending };
};
