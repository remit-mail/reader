import { MailboxSpecialUse } from "@remit/domain-enums";
import {
	type MailboxNameCandidate,
	resolveMailboxByLeafName,
} from "./mailbox-name.js";

// Ordered best-first and lower case, the shape `resolveMailboxByLeafName` takes.
// A `[Gmail]/Spam` or `INBOX/Junk E-mail` needs no entry of its own: the leaf is
// what matches.
export const JUNK_FOLDER_NAMES: readonly string[] = [
	"junk",
	"spam",
	"junk e-mail",
	"junk email",
	"bulk mail",
];

export const TRASH_FOLDER_NAMES: readonly string[] = [
	"trash",
	"deleted items",
	"deleted",
	"bin",
];

export interface MailboxRole extends MailboxNameCandidate {
	readonly specialUse?: readonly string[];
}

const carriesRole = (
	mailbox: MailboxRole,
	specialUse: string,
	namesWhenServerDoesNotSaySo: readonly string[],
): boolean =>
	mailbox.specialUse?.includes(specialUse) === true ||
	resolveMailboxByLeafName([mailbox], namesWhenServerDoesNotSaySo) !== null;

export const isJunkMailbox = (mailbox: MailboxRole): boolean =>
	carriesRole(mailbox, MailboxSpecialUse.Junk, JUNK_FOLDER_NAMES);

export const isTrashMailbox = (mailbox: MailboxRole): boolean =>
	carriesRole(mailbox, MailboxSpecialUse.Trash, TRASH_FOLDER_NAMES);
