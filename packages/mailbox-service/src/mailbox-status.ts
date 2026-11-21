import type { ImapMailboxStatus, MailboxStatusRead } from "./types.js";

/** The status of a STATUS read, for callers to whom a refusal is a failure. */
export const statusOrThrow = (
	read: MailboxStatusRead,
	mailboxPath: string,
): ImapMailboxStatus => {
	if (read.outcome === "Refused") {
		throw new Error(`IMAP STATUS returned no result for ${mailboxPath}`);
	}
	return read.status;
};
