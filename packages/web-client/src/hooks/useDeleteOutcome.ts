/**
 * What a delete is about to do to a specific set of rows — the one derivation
 * every delete confirmation words itself from (#845, #855).
 *
 * `MessageMoveService.deleteMessages` moves a message to its account's Trash
 * unless it is already there, in which case the same keypress is an IMAP
 * expunge and nothing survives it; and it refuses the call outright when the
 * account appoints no Trash. That branch is per message and per account, not
 * per view, so the mailbox list, the brief and Flagged all have to ask it of
 * the rows they are actually about to delete — the brief and Flagged hold rows
 * from several mailboxes and several accounts at once.
 *
 * The decision itself is `deleteOutcomeFor`, kept pure in `lib/format`; this is
 * only the read that feeds it.
 */
import { useMemo } from "react";
import {
	type DeleteOutcome,
	type DeleteTarget,
	deleteOutcomeFor,
} from "@/lib/format";
import { useTrashByAccount } from "./useArchiveMailbox";

/** The outcome of deleting `targets`. */
export const useDeleteOutcome = (
	targets: readonly DeleteTarget[],
): DeleteOutcome => {
	const { trashByAccount, hasAppointments, isError } = useTrashByAccount();

	return useMemo(
		() =>
			deleteOutcomeFor({ targets, trashByAccount, hasAppointments, isError }),
		[targets, trashByAccount, hasAppointments, isError],
	);
};
