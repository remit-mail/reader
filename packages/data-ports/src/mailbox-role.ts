import { MailboxSpecialUse } from "@remit/domain-enums";

export interface MailboxRole {
	readonly fullPath: string;
	readonly specialUse?: readonly string[];
}

export const JUNK_FOLDER_NAMES: readonly string[] = [
	"junk",
	"spam",
	"bulk mail",
	"junk e-mail",
	"[gmail]/spam",
];

export const TRASH_FOLDER_NAMES: readonly string[] = [
	"trash",
	"deleted items",
	"deleted",
	"[gmail]/trash",
	"[gmail]/bin",
];

const carriesRole = (
	mailbox: MailboxRole,
	specialUse: string,
	pathsWhenServerDoesNotSaySo: readonly string[],
): boolean =>
	mailbox.specialUse?.includes(specialUse) === true ||
	pathsWhenServerDoesNotSaySo.includes(mailbox.fullPath.toLowerCase());

export const isJunkMailbox = (mailbox: MailboxRole): boolean =>
	carriesRole(mailbox, MailboxSpecialUse.Junk, JUNK_FOLDER_NAMES);

export const isTrashMailbox = (mailbox: MailboxRole): boolean =>
	carriesRole(mailbox, MailboxSpecialUse.Trash, TRASH_FOLDER_NAMES);
