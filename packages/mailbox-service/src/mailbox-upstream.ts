const stringField = (value: unknown, key: string): string => {
	if (!(value instanceof Object)) return "";
	const field = Reflect.get(value, key);
	return typeof field === "string" ? field : "";
};

/**
 * Read a tagged-NO outcome out of an IMAP failure.
 *
 * The two outcomes below are each a folder operation finding the server already
 * in the state it was asked for — the operation having happened, not failing.
 * Reading them as failures marks the row `failed` and rethrows, and since folder
 * management shares the account's per-account FIFO group with mailbox sync, that
 * un-acked rethrow holds back every later sync for the account.
 *
 * Both places the server can say so are read. `message` carries it when the
 * client raises the error itself; RFC 5530's response code and its text carry it
 * when the server does. ImapFlow surfaces a tagged NO as a bare "Command failed"
 * with the code on the error, which is why matching the message alone never
 * caught a real Dovecot answer.
 */
const saidByServer = (error: Error): string =>
	`${error.message} ${stringField(error, "responseText")}`;

/** The folder is not on the server: a delete has nothing left to do. */
export const isMailboxAbsentUpstream = (error: unknown): boolean => {
	if (!(error instanceof Error)) return false;
	if (stringField(error, "serverResponseCode") === "NONEXISTENT") return true;
	return /not found|does ?n.?t exist/i.test(saidByServer(error));
};

/** The folder is already on the server: a create has nothing left to do. */
export const isMailboxPresentUpstream = (error: unknown): boolean => {
	if (!(error instanceof Error)) return false;
	if (stringField(error, "serverResponseCode") === "ALREADYEXISTS") return true;
	return /already exists/i.test(saidByServer(error));
};

/**
 * Something after the server RENAME failed — the local settle, not the
 * mutation. The rename landed, so this is never a refused rename: marking the
 * rows `failed` would offer a retry of work the server has already done, and
 * `fullPath` would go on naming a path the server no longer holds.
 *
 * It is rethrown rather than swallowed. The rows are still `pending` with their
 * targets recorded, so the redelivery's guard passes and the settle runs again;
 * swallowing it would ack the message and leave the subtree `pending` forever,
 * skipped by message sync with no route out.
 */
/**
 * The folder a rename was to move is confirmed gone: the server refused the
 * RENAME as non-existent, and its own listing holds neither the path being left
 * nor the path being aimed at.
 *
 * It is a distinct kind because it is the only answer that may remove a folder
 * and its mail. Re-reading the server's response code at the call site would
 * make every unclassifiable `NONEXISTENT` — a listing that could not be read, a
 * path the comparison normalized wrongly — destroy the user's mail; here the
 * decision is made once, where the evidence is.
 */
export class FolderGoneUpstreamError extends Error {
	name = "FolderGoneUpstreamError";
	readonly cause: unknown;

	constructor(mailboxId: string, oldPath: string, cause: unknown) {
		super(
			`Folder ${mailboxId} is gone from the mail server: neither "${oldPath}" nor its rename target is listed`,
		);
		this.cause = cause;
	}
}

export class FolderRenameSettleError extends Error {
	name = "FolderRenameSettleError";
	readonly cause: unknown;

	constructor(mailboxId: string, confirmedPath: string, cause: unknown) {
		super(
			`Folder ${mailboxId} was renamed to "${confirmedPath}" but the local settle did not finish`,
		);
		this.cause = cause;
	}
}
