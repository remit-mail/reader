import {
	messageBulkOperationsUpdateFlagsMutation,
	threadDetailOperationsListThreadMessagesQueryKey,
	threadOperationsListThreadsQueryKey,
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

interface MarkAsReadContext {
	threadMessagesKey: ReturnType<
		typeof threadDetailOperationsListThreadMessagesQueryKey
	>;
	threadsListKey: ReturnType<typeof threadOperationsListThreadsQueryKey>;
	previousThreadMessages?: ThreadMessagesData;
	previousThreadsList?: ThreadsListData;
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

			const threadMessagesKey =
				threadDetailOperationsListThreadMessagesQueryKey({
					path: { threadId },
				});
			const threadsListKey = threadOperationsListThreadsQueryKey({
				path: { mailboxId },
			});

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesKey }),
				queryClient.cancelQueries({ queryKey: threadsListKey }),
			]);

			const previousThreadMessages =
				queryClient.getQueryData<ThreadMessagesData>(threadMessagesKey);
			const previousThreadsList =
				queryClient.getQueryData<ThreadsListData>(threadsListKey);

			if (previousThreadMessages) {
				queryClient.setQueryData<ThreadMessagesData>(threadMessagesKey, {
					...previousThreadMessages,
					items: setReadOnItems(
						previousThreadMessages.items,
						messageIds,
						isRead,
					),
				});
			}

			if (previousThreadsList) {
				queryClient.setQueryData<ThreadsListData>(threadsListKey, {
					...previousThreadsList,
					pages: previousThreadsList.pages.map((page) => ({
						...page,
						items: setReadOnItems(page.items, messageIds, isRead),
					})),
				});
			}

			return {
				threadMessagesKey,
				threadsListKey,
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
			if (context.previousThreadMessages) {
				queryClient.setQueryData(
					context.threadMessagesKey,
					context.previousThreadMessages,
				);
			}
			if (context.previousThreadsList) {
				queryClient.setQueryData(
					context.threadsListKey,
					context.previousThreadsList,
				);
			}
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			queryClient.invalidateQueries({ queryKey: context.threadMessagesKey });
			queryClient.invalidateQueries({ queryKey: context.threadsListKey });
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
