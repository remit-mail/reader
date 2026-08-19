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
 * The decision itself is `deleteOutcomeFor`, kept pure in `lib/format`; this is
 * only the read that feeds it.
 */
import { useMemo } from "react";
import { type DeleteOutcome, deleteOutcomeFor } from "@/lib/format";
import { useTrashMailboxIds } from "./useArchiveMailbox";

/** The outcome of deleting the rows filed in `mailboxIds`. */
export const useDeleteOutcome = (
	mailboxIds: readonly string[],
): DeleteOutcome => {
	const { trashMailboxIds, isLoading, isError } = useTrashMailboxIds();

	return useMemo(
		() => deleteOutcomeFor({ mailboxIds, trashMailboxIds, isLoading, isError }),
		[mailboxIds, trashMailboxIds, isLoading, isError],
	);
};
