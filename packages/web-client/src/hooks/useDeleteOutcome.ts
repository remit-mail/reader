/**
 * What a delete is about to do to a specific set of rows — the one derivation
 * every delete confirmation words itself from (#845, #855).
 *
 * `MessageMoveService.deleteMessages` moves a message to its account's Trash
 * unless it is already there, in which case the same keypress is an IMAP
 * expunge and nothing survives it. That branch is per message, not per view, so
 * the mailbox list, the brief and Flagged all have to ask it of the rows they
 * are actually about to delete — the brief and Flagged hold rows from several
 * mailboxes and several accounts at once.
 *
 * One row bound for an expunge makes the whole delete unrecoverable, so a mixed
 * set is asked as a permanent delete: the dialog may only overstate what is
 * kept when nothing is lost by it, never understate it.
 */
import { useMemo } from "react";
import type { DeleteOutcome } from "@/lib/format";
import { useTrashMailboxIds } from "./useArchiveMailbox";

/**
 * The outcome of deleting the rows filed in `mailboxIds`. `unknown` whenever
 * the answer is not established yet — the Trash appointments still loading, an
 * empty set, or a row whose mailbox this view cannot name — because guessing
 * the reversible half over an expunge is the dishonesty this exists to remove.
 */
export const useDeleteOutcome = (
	mailboxIds: readonly (string | undefined)[],
): DeleteOutcome => {
	const { trashMailboxIds, isLoading } = useTrashMailboxIds();

	return useMemo(() => {
		if (isLoading) return "unknown";
		if (mailboxIds.length === 0) return "unknown";
		if (mailboxIds.some((id) => id === undefined)) return "unknown";
		if (mailboxIds.some((id) => id !== undefined && trashMailboxIds.has(id))) {
			return "permanent";
		}
		return "trash";
	}, [mailboxIds, trashMailboxIds, isLoading]);
};
