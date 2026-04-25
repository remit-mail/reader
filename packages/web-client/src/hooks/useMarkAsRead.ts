import {
	mailboxOperationsListMailboxesQueryKey,
	messageBulkOperationsUpdateFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
	threadOperationsSearchThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

interface UseMarkAsReadOptions {
	messages: RemitImapThreadMessageResponse[];
	expandedIds: Set<string>;
	threadId: string;
	mailboxId: string;
	accountId?: string;
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

interface MarkAsReadContext {
	threadMessagesPrefix: readonly unknown[];
	threadsListPrefix: readonly unknown[];
	threadsSearchPrefix: readonly unknown[];
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: SnapshotEntry<ThreadsListData>[];
}

const setReadOnItems = (
	items: RemitImapThreadMessageResponse[],
	messageIds: Set<string>,
	isRead: boolean,
): RemitImapThreadMessageResponse[] =>
	items.map((item) =>
		messageIds.has(item.messageId) ? { ...item, isRead } : item,
	);

/**
 * Pure helper: pick the message IDs that should be marked as read.
 *
 * A message is eligible when it is currently unread, currently expanded,
 * and has not already been marked (or is mid-flight) during this thread
 * view. Extracted so the policy can be exercised without rendering React.
 */
export const selectMessagesToMarkRead = (
	messages: RemitImapThreadMessageResponse[],
	expandedIds: Set<string>,
	alreadyMarked: Set<string>,
	pending: Set<string>,
): string[] =>
	messages
		.filter(
			(m) =>
				!m.isRead &&
				expandedIds.has(m.threadMessageId) &&
				!alreadyMarked.has(m.messageId) &&
				!pending.has(m.messageId),
		)
		.map((m) => m.messageId);

export const useMarkAsRead = ({
	messages,
	expandedIds,
	threadId,
	mailboxId,
	accountId,
}: UseMarkAsReadOptions) => {
	const queryClient = useQueryClient();
	const markedAsReadRef = useRef<Set<string>>(new Set());
	const pendingRef = useRef<Set<string>>(new Set());

	const { mutate: markAsRead } = useMutation({
		...messageBulkOperationsUpdateFlagsMutation(),
		onMutate: async (variables): Promise<MarkAsReadContext> => {
			const messageIds = new Set(variables.body.messageIds ?? []);
			const isRead = variables.body.isRead ?? true;

			const threadMessagesPrefix =
				threadDetailOperationsListThreadMessagesQueryKey({
					path: { threadId },
				});
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

			queryClient.setQueriesData<ThreadMessagesData>(
				{ queryKey: threadMessagesPrefix },
				(old) => {
					if (!old) return old;
					return {
						...old,
						items: setReadOnItems(old.items, messageIds, isRead),
					};
				},
			);

			const patchListData = (old: ThreadsListData | undefined) => {
				if (!old) return old;
				return {
					...old,
					pages: old.pages.map((page) => ({
						...page,
						items: setReadOnItems(page.items, messageIds, isRead),
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

			return {
				threadMessagesPrefix,
				threadsListPrefix,
				threadsSearchPrefix,
				previousThreadMessages,
				previousThreadsList,
			};
		},
		onSuccess: (_data, variables) => {
			const messageIds = variables.body.messageIds ?? [];
			for (const id of messageIds) {
				markedAsReadRef.current.add(id);
				pendingRef.current.delete(id);
			}
		},
		onError: (_error, variables, context) => {
			const messageIds = variables.body.messageIds ?? [];
			for (const id of messageIds) {
				pendingRef.current.delete(id);
			}
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
			queryClient.invalidateQueries({ queryKey: context.threadMessagesPrefix });
			queryClient.invalidateQueries({ queryKey: context.threadsListPrefix });
			queryClient.invalidateQueries({ queryKey: context.threadsSearchPrefix });
			// Refresh the sidebar mailbox list so the unread badge picks up the
			// next backend `unseenCount` (which is owned by IMAP sync).
			if (accountId) {
				queryClient.invalidateQueries({
					queryKey: mailboxOperationsListMailboxesQueryKey({
						path: { accountId },
					}),
				});
			}
		},
	});

	const markMessagesRead = useCallback(
		(messageIds: string[]) => {
			const idsToMark = messageIds.filter(
				(id) => !markedAsReadRef.current.has(id) && !pendingRef.current.has(id),
			);
			if (idsToMark.length === 0) return;

			for (const id of idsToMark) {
				pendingRef.current.add(id);
			}

			markAsRead({
				body: {
					messageIds: idsToMark,
					isRead: true,
				},
			});
		},
		[markAsRead],
	);

	const eligibleIds = useMemo(
		() =>
			selectMessagesToMarkRead(
				messages,
				expandedIds,
				markedAsReadRef.current,
				pendingRef.current,
			),
		[messages, expandedIds],
	);

	// Mark as read immediately when a message is expanded — match Gmail
	// behaviour. The previous implementation used a 10s delay plus an
	// "all expanded" gate that meant most reads silently never fired.
	useEffect(() => {
		if (eligibleIds.length === 0) return;
		markMessagesRead(eligibleIds);
	}, [eligibleIds, markMessagesRead]);

	useEffect(() => {
		markedAsReadRef.current.clear();
		pendingRef.current.clear();
	}, [threadId]);
};
