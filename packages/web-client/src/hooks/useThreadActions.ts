/**
 * useThreadActions — the reading pane's verbs for one open thread.
 *
 * Delete, move, star and the compose requests (reply / reply-all / forward),
 * over the same mutation hooks the mailbox list uses. The mailbox view keys
 * them by its route; the brief and Flagged are cross-account, so they key by
 * the open thread's own `mailboxId` / `accountId` (#149).
 */
import { threadDetailOperationsListThreadMessagesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapStarColor,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ComposeMode } from "@/components/compose/ComposeProvider";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useThreadMessageIds } from "@/hooks/useThreadMessageIds";
import { useToggleStar } from "@/hooks/useToggleStar";
import { isStarred } from "@/lib/star";

interface UseThreadActionsOptions {
	thread: RemitImapThreadMessageResponse | undefined;
	/** Mailbox whose listings the mutations patch. Defaults to the thread's own. */
	mailboxId?: string;
	/** Account the move picker offers folders from. Defaults to the thread's own. */
	accountId?: string;
	onAfterOptimisticRemove?: (messageIds: string[]) => void;
}

export interface ThreadActions {
	mailboxId: string | undefined;
	accountId: string | undefined;
	/**
	 * The open message's star colour, read from the conversation itself. `none`
	 * is a star's absent state; `undefined` means no thread is open.
	 */
	star: RemitImapStarColor | undefined;
	deleteThread: () => void;
	moveThread: (destinationMailboxId: string) => void;
	toggleStar: () => void;
	composeRequest: ComposeMode | null;
	requestCompose: (mode: ComposeMode) => void;
	clearComposeRequest: () => void;
}

export const useThreadActions = ({
	thread,
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

	const { toggleStar: toggleStarFor } = useToggleStar({
		threadId: thread?.threadId ?? "",
		mailboxId: resolvedMailboxId ?? "",
	});

	// The conversation the pane has open, on the key `ConversationView` already
	// holds — one request, one cache entry, and the toolbar and the message card
	// answer from the same row. A list row is a copy that survives its listing:
	// once the mail no longer matches the browsed predicate the row stops being
	// refreshed, and a star read off it is whatever was true when it was last
	// listed.
	const { data: conversation } = useQuery({
		...threadDetailOperationsListThreadMessagesOptions({
			path: { threadId: thread?.threadId ?? "" },
		}),
		enabled: Boolean(thread?.threadId),
	});

	const openMessage = conversation?.items.find(
		(message) => message.messageId === thread?.messageId,
	);
	const star = openMessage?.star ?? thread?.star;

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
		toggleStarFor(thread.messageId, isStarred(star));
	}, [thread, star, toggleStarFor]);

	const [composeRequest, setComposeRequest] = useState<ComposeMode | null>(
		null,
	);
	const clearComposeRequest = useCallback(() => setComposeRequest(null), []);

	return {
		mailboxId: resolvedMailboxId,
		accountId: resolvedAccountId,
		star,
		deleteThread,
		moveThread,
		toggleStar,
		composeRequest,
		requestCompose: setComposeRequest,
		clearComposeRequest,
	};
};
