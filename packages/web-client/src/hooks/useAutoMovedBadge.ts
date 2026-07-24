import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAutoMovedInfo } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	autoMovedLabel,
	isAutoMoveInEffect,
	resolveUndoTargetMailboxId,
} from "@/lib/auto-moved";
import { getMailboxDisplayName } from "@/lib/folder-roles";
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
	/**
	 * Settings › Filters link, present only for a standing-filter move — undo
	 * returns the message but never disables the filter, so the badge points to
	 * where the filter can be managed.
	 */
	filtersHref?: string;
}

/**
 * Composes the account's mailboxes with the message's `autoMoved` projection
 * into everything the `AutoMovedBadge` kit component needs: the derived "still
 * in effect" gate, the plain-language label, and a one-click undo bound to the
 * existing `moveMessages` mutation (no new endpoint — moves back through the
 * same bulk move operation, the other direction).
 *
 * Both auto-move shapes are handled. A classifier move resolves its
 * Inbox/Junk role mailboxes; a standing-filter move names an arbitrary source
 * folder, whose display name is resolved from the account's mailbox list, and
 * carries a Settings › Filters link so the filter that keeps moving mail is one
 * tap away — undo does not disable it.
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

	const { data: mailboxes } = useQuery({
		...mailboxOperationsListMailboxesOptions({
			path: { accountId: accountId ?? "" },
		}),
		staleTime: Infinity,
		enabled: !!accountId && autoMoved?.fromMailboxId !== undefined,
	});

	const roleMailboxes = { inboxMailboxId, junkMailboxId };
	const show = isAutoMoveInEffect(autoMoved, mailboxId, roleMailboxes);
	const undoTargetMailboxId = resolveUndoTargetMailboxId(
		autoMoved,
		roleMailboxes,
	);

	const handleUndo = useCallback(() => {
		if (!undoTargetMailboxId) return;
		moveMessages([messageId], undoTargetMailboxId);
	}, [moveMessages, messageId, undoTargetMailboxId]);

	if (!show || !autoMoved) {
		return { show: false, label: "", isUndoing: false };
	}

	const sourceFolderName = autoMoved.fromMailboxId
		? mailboxes?.items
				.filter((mailbox) => mailbox.mailboxId === autoMoved.fromMailboxId)
				.map((mailbox) => getMailboxDisplayName(mailbox.fullPath))[0]
		: undefined;

	return {
		show: true,
		label: autoMovedLabel(autoMoved, sourceFolderName),
		onUndo: undoTargetMailboxId ? handleUndo : undefined,
		isUndoing: isPending,
		...(autoMoved.filterId ? { filtersHref: "/settings/filters" } : {}),
	};
};
