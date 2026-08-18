import { CanonicalMailboxRole } from "@remit/domain-enums";
import { ROLE_NAME_HINTS, resolveMailboxForRole } from "./folder-role.js";

/**
 * The conventional names for a role, taken from the one table every
 * special-folder lookup shares (`folder-role.ts`). Exported so the SQLite junk
 * repair can spell the same rule; a second list here is how `INBOX/Sent` and
 * `INBOX/Spam` came to be resolvable in one place and not another.
 */
export const JUNK_FOLDER_NAMES: readonly string[] =
	ROLE_NAME_HINTS[CanonicalMailboxRole.Junk] ?? [];

export const TRASH_FOLDER_NAMES: readonly string[] =
	ROLE_NAME_HINTS[CanonicalMailboxRole.Trash] ?? [];

export interface MailboxRole {
	readonly fullPath: string;
	readonly hierarchyDelimiter?: string;
	readonly specialUse?: readonly string[];
}

/**
 * Whether one mailbox, considered alone, carries a role: its SPECIAL-USE flag
 * or its conventional name. A single mailbox carries no account context, so
 * this cannot see the user's appointment — a caller holding an accountId asks
 * `IMailboxSpecialUseRepository` instead, which does.
 */
const carriesRole = (
	mailbox: MailboxRole,
	role: (typeof CanonicalMailboxRole)[keyof typeof CanonicalMailboxRole],
): boolean =>
	resolveMailboxForRole(role, [
		{
			mailboxId: "",
			fullPath: mailbox.fullPath,
			hierarchyDelimiter: mailbox.hierarchyDelimiter ?? "",
			specialUse: mailbox.specialUse,
		},
	]) !== null;

export const isJunkMailbox = (mailbox: MailboxRole): boolean =>
	carriesRole(mailbox, CanonicalMailboxRole.Junk);

export const isTrashMailbox = (mailbox: MailboxRole): boolean =>
	carriesRole(mailbox, CanonicalMailboxRole.Trash);
