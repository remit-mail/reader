/**
 * useThreadActions — the reading pane's verbs for one open thread.
 *
 * Delete, move and star, over the same mutation hooks the mailbox list uses.
 * The mailbox view keys them by its route; the brief and Flagged are
 * cross-account, so they key by the open thread's own `mailboxId` /
 * `accountId` (#149).
 *
 * Answering a message is not here: reply, reply-all and forward are a segment
 * under the message, so they are a navigation rather than a verb a pane holds.
 */
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useCallback } from "react";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useThreadMessageIds } from "@/hooks/useThreadMessageIds";
import { useThreadConversation } from "@/hooks/useThreadRow";
import { useToggleStar } from "@/hooks/useToggleStar";

interface UseThreadActionsOptions {
	thread: RemitImapThreadMessageResponse | undefined;
	/**
	 * Whether the pane has this thread open, so its conversation is on screen
	 * and already fetched. The star then answers from that conversation: a list
	 * row is a copy that survives its listing, and once the mail no longer
	 * matches the browsed predicate the row stops being refreshed, so a star
	 * read off it is whatever was true when it was last listed (#602).
	 *
	 * A cursor target is not open — it answers from its own live listing row,
	 * because pulling a conversation for it would be a request per keystroke.
	 */
	isOpen?: boolean;
	/** Mailbox whose listings the mutations patch. Defaults to the thread's own. */
	mailboxId?: string;
	/** Account the move picker offers folders from. Defaults to the thread's own. */
	accountId?: string;
	onAfterOptimisticRemove?: (messageIds: string[]) => void;
}

export interface ThreadActions {
	mailboxId: string | undefined;
	accountId: string | undefined;
	isStarred: boolean | undefined;
	deleteThread: () => void;
	moveThread: (destinationMailboxId: string) => void;
	toggleStar: () => void;
}

export const useThreadActions = ({
	thread,
	isOpen = false,
	mailboxId,
	accountId,
	onAfterOptimisticRemove,
}: UseThreadActionsOptions): ThreadActions => {
	const resolvedMailboxId = mailboxId ?? thread?.mailboxId;
	// `accountConfigId` is the caller's own identity, not an account: every
	// `/accounts/{accountId}/…` call made with it 404s. The row carries a real
	// `accountId` only when it came from the unified listing, so anything else
	// resolves through the mailbox cache.
	const knownAccountId = accountId ?? thread?.accountId;
	const { accountId: mailboxAccountId } = useMailboxAccount(
		knownAccountId ? undefined : resolvedMailboxId,
	);
	const resolvedAccountId = knownAccountId ?? mailboxAccountId;
	const threadMessageIds = useThreadMessageIds();

	const { deleteMessages } = useDeleteMessages({
		mailboxId: resolvedMailboxId ?? "",
		threadId: thread?.threadId,
		accountId: resolvedAccountId,
		onAfterOptimisticRemove,
	});

	const { moveMessages } = useMoveMessages({
		mailboxId: resolvedMailboxId ?? "",
		threadId: thread?.threadId,
		accountId: resolvedAccountId,
		onAfterOptimisticRemove,
	});

	// The conversation the pane has open, off the entry `ConversationView` and
	// `useThreadRow` already hold, so the toolbar and the message card answer
	// from the same row for no extra request.
	const conversation = useThreadConversation(
		isOpen ? thread?.threadId : undefined,
	);

	const openMessage = conversation.find(
		(message) => message.messageId === thread?.messageId,
	);
	const isStarred = openMessage?.hasStars ?? thread?.hasStars;

	const { toggleStar: toggleStarFor } = useToggleStar({
		threadId: thread?.threadId ?? "",
		mailboxId: resolvedMailboxId ?? "",
		messages: conversation,
	});

	const deleteThread = useCallback(() => {
		if (!thread) return;
		deleteMessages(threadMessageIds(thread));
	}, [thread, threadMessageIds, deleteMessages]);

	const moveThread = useCallback(
		(destinationMailboxId: string) => {
			if (!thread) return;
			moveMessages(threadMessageIds(thread), destinationMailboxId);
		},
		[thread, threadMessageIds, moveMessages],
	);

	const toggleStar = useCallback(() => {
		if (!thread) return;
		toggleStarFor(thread.messageId, isStarred ?? false);
	}, [thread, isStarred, toggleStarFor]);

	return {
		mailboxId: resolvedMailboxId,
		accountId: resolvedAccountId,
		isStarred,
		deleteThread,
		moveThread,
		toggleStar,
	};
};
