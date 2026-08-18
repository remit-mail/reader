import type { MailboxItem } from "@remit/data-ports";
import { resolveMailboxByLeafName } from "@remit/data-ports/mailbox-name";

export type SentMailboxCandidate = Pick<
	MailboxItem,
	"mailboxId" | "fullPath" | "hierarchyDelimiter"
>;

const SENT_FOLDER_NAMES = ["sent", "sent items", "sent messages", "sent mail"];

/**
 * The Sent folder by conventional name, for servers that advertise no `\Sent`
 * special-use. Matches the folder's own leaf segment, so it resolves at any
 * depth under any prefix (`INBOX/Sent`, `Mail.Sent Items`, `[Gmail]/Sent Mail`)
 * without knowing which prefixes a server uses.
 */
export const resolveSentMailboxByName = (
	mailboxes: SentMailboxCandidate[],
): SentMailboxCandidate | null =>
	resolveMailboxByLeafName(mailboxes, SENT_FOLDER_NAMES);
