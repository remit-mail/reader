/**
 * Where the Junk verb can file mail, and why it cannot when it cannot (#522).
 * One reading, for every surface that offers the verb: the selection bar, the
 * keyboard, the brief's own bar and the wizard's commit. A second derivation is
 * what let the keyboard open a wizard on a verb the bar was withholding.
 */

export const NO_JUNK_FOLDER_REASON =
	"This account has no Junk folder appointed, so there is nowhere to file these. Appoint one under Settings › Folders.";

export const ALREADY_IN_JUNK_REASON =
	"These are already in Junk, so there is nowhere to file them.";

/**
 * The account's appointed Junk folder, and nothing at all when the account has
 * appointed none or when that folder is the one the mail is already in.
 */
export const junkDestination = (
	junkMailboxId: string | undefined,
	currentMailboxId: string | undefined,
): string | undefined =>
	junkMailboxId !== undefined && junkMailboxId !== currentMailboxId
		? junkMailboxId
		: undefined;

/** Why the verb cannot be offered here, and nothing when it can. */
export const junkWithheldReason = (
	junkMailboxId: string | undefined,
	currentMailboxId: string | undefined,
): string | undefined => {
	if (junkDestination(junkMailboxId, currentMailboxId) !== undefined) {
		return undefined;
	}
	return junkMailboxId === undefined
		? NO_JUNK_FOLDER_REASON
		: ALREADY_IN_JUNK_REASON;
};
