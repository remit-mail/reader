import type { RemitImapAutoMovedInfo } from "@remit/api-http-client/types.gen.ts";
import { useCallback } from "react";
import {
	autoMovedLabel,
	isAutoMoveInEffect,
	resolveUndoTargetMailboxId,
} from "@/lib/auto-moved";
import { useInboxMailbox, useJunkMailbox } from "./useArchiveMailbox";
import { useMoveMessages } from "./useMoveMessages";

interface UseAutoMovedBadgeOptions {
	accountId: string | undefined;
	messageId: string;
	threadId: string;
	/** The message's current mailbox — the row/card it's rendered in. */
	mailboxId: string;
	autoMoved: RemitImapAutoMovedInfo | undefined;
}

export interface AutoMovedBadgeState {
	/** Whether the move is still in effect and the badge should render. */
	show: boolean;
	label: string;
	/** Present only when the undo target mailbox resolved. */
	onUndo?: () => void;
	isUndoing: boolean;
}

/**
 * Composes the account's Inbox/Junk mailboxes with the message's `autoMoved`
 * projection into everything the `AutoMovedBadge` kit component needs: the
 * derived "still in effect" gate, the plain-language label, and a one-click
 * undo bound to the existing `moveMessages` mutation (no new endpoint — moves
 * back through the same bulk move operation, the other direction).
 *
 * `show` re-derives on every render from `mailboxId` — no local dismissed
 * flag. Once `moveMessages` settles, its query invalidation refetches the
 * thread row with its updated `mailboxId`, and the badge naturally stops
 * showing (doc/rules/data-flow.md).
 */
export const useAutoMovedBadge = ({
	accountId,
	messageId,
	threadId,
	mailboxId,
	autoMoved,
}: UseAutoMovedBadgeOptions): AutoMovedBadgeState => {
	const { inboxMailboxId } = useInboxMailbox(accountId);
	const { junkMailboxId } = useJunkMailbox(accountId);
	const { moveMessages, isPending } = useMoveMessages({
		mailboxId,
		threadId,
		accountId,
	});

	const roleMailboxes = { inboxMailboxId, junkMailboxId };
	const show = isAutoMoveInEffect(autoMoved, mailboxId, roleMailboxes);
	const undoTargetMailboxId = autoMoved
		? resolveUndoTargetMailboxId(autoMoved.fromPlacement, roleMailboxes)
		: undefined;

	const handleUndo = useCallback(() => {
		if (!undoTargetMailboxId) return;
		moveMessages([messageId], undoTargetMailboxId);
	}, [moveMessages, messageId, undoTargetMailboxId]);

	if (!show || !autoMoved) {
		return { show: false, label: "", isUndoing: false };
	}

	return {
		show: true,
		label: autoMovedLabel(autoMoved.fromPlacement),
		onUndo: undoTargetMailboxId ? handleUndo : undefined,
		isUndoing: isPending,
	};
};
