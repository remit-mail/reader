import { messageBulkOperationsUpdateFlagsMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { threadKeys } from "./queries/keys";

interface UseMarkAsReadOptions {
	messages: RemitImapThreadMessageResponse[];
	expandedIds: Set<string>;
	threadId: string;
	mailboxId: string;
}

const READ_DELAY_MS = 30_000;

export const useMarkAsRead = ({
	messages,
	expandedIds,
	threadId,
	mailboxId,
}: UseMarkAsReadOptions) => {
	const queryClient = useQueryClient();
	const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
	const markedAsReadRef = useRef<Set<string>>(new Set());

	const { mutate: markAsRead } = useMutation({
		...messageBulkOperationsUpdateFlagsMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: threadKeys.messages(threadId),
			});
			queryClient.invalidateQueries({
				queryKey: threadKeys.list(mailboxId, {}),
				exact: false,
			});
		},
	});

	const markMessagesRead = useCallback(
		(messageIds: string[]) => {
			const idsToMark = messageIds.filter(
				(id) => !markedAsReadRef.current.has(id),
			);
			if (idsToMark.length === 0) return;

			for (const id of idsToMark) {
				markedAsReadRef.current.add(id);
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

	// Get unread messages
	const unreadMessages = messages.filter((m) => !m.isRead);

	// Check if all unread messages are expanded
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

	// Set up 30-second timers for expanded unread messages
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

	// Reset marked messages when thread changes
	useEffect(() => {
		markedAsReadRef.current.clear();
		for (const timer of timersRef.current.values()) {
			clearTimeout(timer);
		}
		timersRef.current.clear();
	}, [threadId]);
};
