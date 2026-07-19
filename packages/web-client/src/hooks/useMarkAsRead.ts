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
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";

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
	threadsListPrefixes: ReadonlyArray<readonly unknown[]>;
	threadsSearchPrefixes: ReadonlyArray<readonly unknown[]>;
	previousThreadMessages: SnapshotEntry<ThreadMessagesData>[];
	previousThreadsList: SnapshotEntry<ThreadsListData>[];
}

/**
 * The mailboxes whose cached listings a batch of message mutations affects.
 *
 * A conversation spans mailboxes (#46), so marking a thread read can touch a
 * received message in INBOX and the user's own reply in Sent at once, and each
 * one's lists live under its own mailbox key. Falls back to the browsed mailbox
 * for ids the thread's messages do not cover.
 */
export const resolveMailboxesForMessages = (
	messageIds: Iterable<string>,
	messages: RemitImapThreadMessageResponse[],
	fallbackMailboxId: string,
): string[] => {
	const byMessageId = new Map(
		messages.map((message) => [message.messageId, message.mailboxId]),
	);
	const mailboxIds = new Set<string>();
	for (const messageId of messageIds) {
		mailboxIds.add(byMessageId.get(messageId) ?? fallbackMailboxId);
	}
	return [...mailboxIds];
};

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
	const { pushError } = useErrorBanners();
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
			const affectedMailboxIds = resolveMailboxesForMessages(
				messageIds,
				messages,
				mailboxId,
			);
			const threadsListPrefixes = affectedMailboxIds.map((id) =>
				threadOperationsListThreadsQueryKey({ path: { mailboxId: id } }),
			);
			const threadsSearchPrefixes = affectedMailboxIds.map((id) =>
				threadOperationsSearchThreadsQueryKey({ path: { mailboxId: id } }),
			);

			await Promise.all([
				queryClient.cancelQueries({ queryKey: threadMessagesPrefix }),
				...threadsListPrefixes.map((queryKey) =>
					queryClient.cancelQueries({ queryKey }),
				),
				...threadsSearchPrefixes.map((queryKey) =>
					queryClient.cancelQueries({ queryKey }),
				),
			]);

			const previousThreadMessages = queryClient
				.getQueriesData<ThreadMessagesData>({ queryKey: threadMessagesPrefix })
				.filter(
					(entry): entry is [readonly unknown[], ThreadMessagesData] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			const previousThreadsList = [
				...threadsListPrefixes,
				...threadsSearchPrefixes,
			]
				.flatMap((queryKey) =>
					queryClient.getQueriesData<ThreadsListData>({ queryKey }),
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

			for (const queryKey of [
				...threadsListPrefixes,
				...threadsSearchPrefixes,
			]) {
				queryClient.setQueriesData<ThreadsListData>(
					{ queryKey },
					patchListData,
				);
			}

			return {
				threadMessagesPrefix,
				threadsListPrefixes,
				threadsSearchPrefixes,
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
		onError: (error, variables, context) => {
			const messageIds = variables.body.messageIds ?? [];
			for (const id of messageIds) {
				pendingRef.current.delete(id);
			}
			if (context) {
				for (const entry of context.previousThreadMessages) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
				for (const entry of context.previousThreadsList) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
			}
			const isRead = variables.body.isRead ?? true;
			pushError({
				title: isRead ? "Couldn't mark as read" : "Couldn't mark as unread",
				detail: formatErrorDetail(error),
			});
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			queryClient.invalidateQueries({ queryKey: context.threadMessagesPrefix });
			for (const queryKey of [
				...context.threadsListPrefixes,
				...context.threadsSearchPrefixes,
			]) {
				queryClient.invalidateQueries({ queryKey });
			}
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally clears state on threadId change; adding threadId to deps causes stale closure issues
	useEffect(() => {
		markedAsReadRef.current.clear();
		pendingRef.current.clear();
	}, [threadId]);
};

/**
 * Standalone hook that exposes a `toggleReadFor` function to mark a set of
 * messages as read or unread. Designed for multi-select mark-read (PR 1)
 * and swipe-to-read (PR 2) use cases that operate outside a thread view.
 */
export const useToggleReadFor = (options: {
	mailboxId: string;
	accountId?: string;
}) => {
	const { mailboxId, accountId } = options;
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const { mutate, isPending } = useMutation({
		...messageBulkOperationsUpdateFlagsMutation(),
		onError: (error, variables) => {
			const isRead = variables.body.isRead ?? true;
			pushError({
				title: isRead ? "Couldn't mark as read" : "Couldn't mark as unread",
				detail: formatErrorDetail(error),
			});
		},
		onSettled: () => {
			queryClient.invalidateQueries({
				queryKey: threadOperationsListThreadsQueryKey({
					path: { mailboxId },
				}),
			});
			queryClient.invalidateQueries({
				queryKey: threadOperationsSearchThreadsQueryKey({
					path: { mailboxId },
				}),
			});
			if (accountId) {
				queryClient.invalidateQueries({
					queryKey: mailboxOperationsListMailboxesQueryKey({
						path: { accountId },
					}),
				});
			}
		},
	});

	const toggleReadFor = useCallback(
		(messageIds: string[], isRead: boolean) => {
			if (messageIds.length === 0) return;
			mutate({ body: { messageIds, isRead } });
		},
		[mutate],
	);

	return { toggleReadFor, isPending };
};
