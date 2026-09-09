import { MailboxSpecialUse } from "@remit/domain-enums";
import type { MailboxItem } from "./types.js";

/**
 * Special-use folders that hold a second copy of mail already reachable through
 * the folder it actually lives in — Gmail's All Mail, Starred and Important.
 */
const VIRTUAL_COPY_SPECIAL_USE: readonly string[] = [
	MailboxSpecialUse.All,
	MailboxSpecialUse.Flagged,
	MailboxSpecialUse.Important,
];

/**
 * Well-known Gmail virtual paths, for servers that do not advertise the
 * special-use attribute. Whole path, never a prefix — a user's own
 * `Starred ideas` folder is real mail.
 */
const VIRTUAL_COPY_FULL_PATHS: readonly string[] = [
	"[gmail]/all mail",
	"[gmail]/starred",
	"[gmail]/important",
];

/**
 * Whether this folder holds mail that also lives in a real folder. Such a
 * folder is a view, not a filing location: seeing a message in it says nothing
 * about where the message was filed, so it neither picks which duplicate a
 * listing drops nor decides where a message lives.
 */
export const isVirtualCopyMailbox = (mailbox: MailboxItem): boolean =>
	mailbox.specialUse?.some((use) => VIRTUAL_COPY_SPECIAL_USE.includes(use)) ===
		true || VIRTUAL_COPY_FULL_PATHS.includes(mailbox.fullPath.toLowerCase());
