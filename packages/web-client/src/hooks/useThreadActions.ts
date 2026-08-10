/**
 * useThreadActions — the reading pane's verbs for one open thread.
 *
 * Delete, move, star and the compose requests (reply / reply-all / forward),
 * over the same mutation hooks the mailbox list uses. The mailbox view keys
 * them by its route; the brief and Flagged are cross-account, so they key by
 * the open thread's own `mailboxId` / `accountId` (#149).
 */
import type {
	RemitImapStarColor,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
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
	/**
	 * The open message's star colour, from `useMessageStar`. A pane showing the
	 * conversation passes it; one acting on a list row under the keyboard cursor
	 * leaves it out and the row answers for itself.
	 */
	star?: RemitImapStarColor;
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
	 * The star colour the verbs act on. `none` is a star's absent state;
	 * `undefined` means no thread is open.
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
	star,
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

	const resolvedStar = star ?? thread?.star;

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
		toggleStarFor(thread.messageId, isStarred(resolvedStar));
	}, [thread, resolvedStar, toggleStarFor]);

	const [composeRequest, setComposeRequest] = useState<ComposeMode | null>(
		null,
	);
	const clearComposeRequest = useCallback(() => setComposeRequest(null), []);

	return {
		mailboxId: resolvedMailboxId,
		accountId: resolvedAccountId,
		star: resolvedStar,
		deleteThread,
		moveThread,
		toggleStar,
		composeRequest,
		requestCompose: setComposeRequest,
		clearComposeRequest,
	};
};
