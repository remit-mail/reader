import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAutoMovedInfo,
	RemitImapMessageSpamReport,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	autoMovedLabel,
	isAutoMoveInEffect,
	resolveUndoTargetMailboxId,
	spamReportLabel,
} from "@/lib/auto-moved";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { useInboxMailbox, useJunkMailbox } from "./useArchiveMailbox";
import { useMoveMessages } from "./useMoveMessages";
import { useReportSpam } from "./useReportSpam";

interface UseAutoMovedBadgeOptions {
	accountId: string | undefined;
	messageId: string;
	threadId: string;
	/** The message's current mailbox — the row/card it's rendered in. */
	mailboxId: string;
	autoMoved: RemitImapAutoMovedInfo | undefined;
	/**
	 * Present when the user reported this message as spam and the report has
	 * not been undone (issue #648). Takes precedence over `autoMoved`: a
	 * report can be a no-op move (the provider's own filter already placed the
	 * message in Junk), so it carries its own badge independent of the
	 * message's current folder, unlike a classifier/filter move.
	 */
	spamReport: RemitImapMessageSpamReport | undefined;
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
 * Composes the account's mailboxes with the message's `autoMoved` and
 * `spamReport` projections into everything the `AutoMovedBadge` kit component
 * needs: the derived "still in effect" gate, the plain-language label, and a
 * one-click undo.
 *
 * Three provenances are handled, `spamReport` taking priority when present:
 * - A spam report (issue #648) undoes via `POST /messages/not-spam`, which
 *   resolves its own restore target server-side — the client never needs an
 *   Inbox/Junk lookup for it, and the badge shows regardless of the message's
 *   current folder (a report can be a no-op move).
 * - A classifier move resolves its Inbox/Junk role mailboxes and undoes via a
 *   plain move back to the source role.
 * - A standing-filter move names an arbitrary source folder, whose display
 *   name is resolved from the account's mailbox list, and carries a
 *   Settings › Filters link so the filter that keeps moving mail is one tap
 *   away — undo does not disable it.
 *
 * `show` re-derives on every render from `mailboxId` (or from `spamReport`'s
 * presence) — no local dismissed flag. Once the undo mutation settles, its
 * query invalidation refetches the thread row with its updated state, and the
 * badge naturally stops showing (doc/rules/data-flow.md).
 */
export const useAutoMovedBadge = ({
	accountId,
	messageId,
	threadId,
	mailboxId,
	autoMoved,
	spamReport,
}: UseAutoMovedBadgeOptions): AutoMovedBadgeState => {
	const { inboxMailboxId } = useInboxMailbox(accountId);
	const { junkMailboxId } = useJunkMailbox(accountId);
	const { moveMessages, isPending: isMoveUndoing } = useMoveMessages({
		mailboxId,
		threadId,
		accountId,
	});
	const { notSpam, isRestoring: isSpamUndoing } = useReportSpam({
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
	const undoTargetMailboxId = resolveUndoTargetMailboxId(
		autoMoved,
		roleMailboxes,
	);

	const handleUndoMove = useCallback(() => {
		if (!undoTargetMailboxId) return;
		moveMessages([messageId], undoTargetMailboxId);
	}, [moveMessages, messageId, undoTargetMailboxId]);

	const handleUndoReport = useCallback(() => {
		notSpam([messageId]);
	}, [notSpam, messageId]);

	if (spamReport) {
		return {
			show: true,
			label: spamReportLabel,
			onUndo: handleUndoReport,
			isUndoing: isSpamUndoing,
		};
	}

	const show = isAutoMoveInEffect(autoMoved, mailboxId, roleMailboxes);
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
		onUndo: undoTargetMailboxId ? handleUndoMove : undefined,
		isUndoing: isMoveUndoing,
		...(autoMoved.filterId ? { filtersHref: "/settings/filters" } : {}),
	};
};
