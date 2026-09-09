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
 * only the read that feeds it. The two facts beside it are the folders the
 * refusal has to name: the one a stale appointment lost, and the one reader
 * guessed and is asking the user to confirm.
 */
import { useMemo } from "react";
import {
	type DeleteOutcome,
	type DeleteTarget,
	deleteOutcomeFor,
} from "@/lib/format";
import { useTrashByAccount } from "./useArchiveMailbox";

export interface DeleteOutcomeResult {
	outcome: DeleteOutcome;
	/** The folder the user appointed, when it is gone from the mail server. */
	staleFolderLabel?: string;
	/**
	 * `unconfirmed`: the folder reader matched by name, which the rows are
	 * already inside. The prompt opens with it chosen, so confirming the guess is
	 * one tap.
	 */
	guessedMailboxId?: string;
}

/** The outcome of deleting `targets`. */
export const useDeleteOutcome = (
	targets: readonly DeleteTarget[],
): DeleteOutcomeResult => {
	const { trashByAccount, hasAppointments, isError } = useTrashByAccount();

	return useMemo(() => {
		const outcome = deleteOutcomeFor({
			targets,
			trashByAccount,
			hasAppointments,
			isError,
		});
		const trashFor = (target: DeleteTarget) =>
			target.accountId ? trashByAccount.get(target.accountId) : undefined;
		return {
			outcome,
			// The account `deleteOutcomeFor` refused on, found the way it found it.
			staleFolderLabel: targets
				.map(trashFor)
				.find((trash) => trash?.source === "Stale")?.staleFolderPath,
			// The folder that produced `unconfirmed`: a row's own mailbox, which is
			// also its account's guessed Trash. Only that row says which folder is
			// being asked about — a row filed elsewhere is moving, not expunging.
			guessedMailboxId:
				outcome === "unconfirmed"
					? targets.find(
							(target) => trashFor(target)?.mailboxId === target.mailboxId,
						)?.mailboxId
					: undefined,
		};
	}, [targets, trashByAccount, hasAppointments, isError]);
};
