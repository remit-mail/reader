import {
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

const READ_DELAY_MS = 10_000;

const setReadOnItems = (
	items: RemitImapThreadMessageResponse[],
	messageIds: Set<string>,
	isRead: boolean,
): RemitImapThreadMessageResponse[] =>
	items.map((item) =>
		messageIds.has(item.messageId) ? { ...item, isRead } : item,
	);

export const useMarkAsRead = ({
	messages,
	expandedIds,
	threadId,
	mailboxId,
}: UseMarkAsReadOptions) => {
	const queryClient = useQueryClient();
	const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
	const markedAsReadRef = useRef<Set<string>>(new Set());
	const pendingRef = useRef<Set<string>>(new Set());

	const { mutate: markAsRead } = useMutation({
		...messageBulkOperationsUpdateFlagsMutation(),
		onMutate: async (variables): Promise<MarkAsReadContext> => {
			const messageIds = new Set(variables.body.messageIds ?? []);
			const isRead = variables.body.isRead ?? true;

			// Use partial-key prefixes — see useToggleStar.ts for rationale.
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

	const unreadMessages = useMemo(
		() => messages.filter((m) => !m.isRead),
		[messages],
	);

	useEffect(() => {
		if (unreadMessages.length === 0) return;

		const allExpanded = unreadMessages.every((m) =>
			expandedIds.has(m.threadMessageId),
		);

		if (allExpanded) {
			const unreadMessageIds = unreadMessages
				.map((m) => m.messageId)
				.filter((id) => !markedAsReadRef.current.has(id));

			if (unreadMessageIds.length > 0) {
				markMessagesRead(unreadMessageIds);
			}
		}
	}, [unreadMessages, expandedIds, markMessagesRead]);

	useEffect(() => {
		const currentTimers = timersRef.current;

		for (const message of unreadMessages) {
			const isExpanded = expandedIds.has(message.threadMessageId);
			const hasTimer = currentTimers.has(message.messageId);
			const alreadyMarked = markedAsReadRef.current.has(message.messageId);

			if (isExpanded && !hasTimer && !alreadyMarked) {
				const timer = setTimeout(() => {
					markMessagesRead([message.messageId]);
					currentTimers.delete(message.messageId);
				}, READ_DELAY_MS);
				currentTimers.set(message.messageId, timer);
			} else if (!isExpanded && hasTimer) {
				clearTimeout(currentTimers.get(message.messageId));
				currentTimers.delete(message.messageId);
			}
		}

		return () => {
			for (const timer of currentTimers.values()) {
				clearTimeout(timer);
			}
		};
	}, [unreadMessages, expandedIds, markMessagesRead]);

	useEffect(() => {
		markedAsReadRef.current.clear();
		for (const timer of timersRef.current.values()) {
			clearTimeout(timer);
		}
		timersRef.current.clear();
	}, [threadId]);
};
