import {
	AccountSettingName,
	CanonicalMailboxRole,
	MailboxSpecialUse,
} from "@remit/domain-enums";
import {
	composeSettingName,
	SETTING_NAME_SEPARATOR,
} from "./account-settings.js";
import {
	type MailboxNameCandidate,
	resolveMailboxByLeafName,
} from "./mailbox-name.js";

export type CanonicalMailboxRoleValue =
	(typeof CanonicalMailboxRole)[keyof typeof CanonicalMailboxRole];

/** The fixed anchor set, in the RFC's canonical display order. */
export const CANONICAL_ROLES: readonly CanonicalMailboxRoleValue[] =
	Object.values(CanonicalMailboxRole);

const isCanonicalRole = (value: string): value is CanonicalMailboxRoleValue =>
	(CANONICAL_ROLES as readonly string[]).includes(value);

/**
 * The stored `AccountSetting` name holding one role's appointment. Composed
 * here rather than at either reader, so the backend that writes it and the
 * repository that reads it can never disagree about the key.
 */
export const composeFolderRoleAppointmentName = (
	accountId: string,
	role: CanonicalMailboxRoleValue,
): string =>
	composeSettingName(
		AccountSettingName.FolderRoleAppointment,
		`${accountId}${SETTING_NAME_SEPARATOR}${role}`,
	);

/**
 * Split a stored appointment name back into its two-part target. Unlike the
 * single-target composites (`MailboxRole#<id>`), this setting composes two ids
 * after the base, so it parses the suffix itself rather than reusing
 * `targetIdOf`.
 */
export const parseFolderRoleAppointmentName = (
	name: string,
): { accountId: string; role: CanonicalMailboxRoleValue } | undefined => {
	const [base, ...rest] = name.split(SETTING_NAME_SEPARATOR);
	if (base !== AccountSettingName.FolderRoleAppointment) return undefined;
	const role = rest[rest.length - 1];
	const accountId = rest.slice(0, -1).join(SETTING_NAME_SEPARATOR);
	if (!accountId || !role || !isCanonicalRole(role)) return undefined;
	return { accountId, role };
};

/**
 * RFC 6154 SPECIAL-USE flag per role. Inbox has no SPECIAL-USE flag (RFC 3501
 * reserves the name itself); a role with no entry here is matched by name hint
 * only.
 */
export const ROLE_SPECIAL_USE: Partial<
	Record<CanonicalMailboxRoleValue, string>
> = {
	[CanonicalMailboxRole.Drafts]: MailboxSpecialUse.Drafts,
	[CanonicalMailboxRole.Sent]: MailboxSpecialUse.Sent,
	[CanonicalMailboxRole.Archive]: MailboxSpecialUse.Archive,
	[CanonicalMailboxRole.Junk]: MailboxSpecialUse.Junk,
	[CanonicalMailboxRole.Trash]: MailboxSpecialUse.Trash,
	[CanonicalMailboxRole.All]: MailboxSpecialUse.All,
	[CanonicalMailboxRole.Flagged]: MailboxSpecialUse.Flagged,
};

/**
 * Weak name hints, ordered best-first and lower case: the last resort for a
 * provider that advertises no SPECIAL-USE and whose user has appointed
 * nothing. Deliberately small — a guess that seeds a proposal, never a
 * substitute for server truth or for what the user chose.
 */
export const ROLE_NAME_HINTS: Partial<
	Record<CanonicalMailboxRoleValue, readonly string[]>
> = {
	[CanonicalMailboxRole.Drafts]: ["drafts", "draft", "concepten"],
	[CanonicalMailboxRole.Sent]: [
		"sent",
		"sent items",
		"sent messages",
		"sent mail",
	],
	[CanonicalMailboxRole.Archive]: ["archive", "archives", "all mail"],
	[CanonicalMailboxRole.Junk]: [
		"junk",
		"spam",
		"junk e-mail",
		"junk email",
		"bulk mail",
	],
	[CanonicalMailboxRole.Trash]: [
		"trash",
		"deleted items",
		"deleted messages",
		"deleted",
		"bin",
	],
	[CanonicalMailboxRole.All]: ["all mail", "all"],
};

/** The minimal mailbox shape role resolution reads. */
export interface RoleMailboxCandidate extends MailboxNameCandidate {
	specialUse?: readonly string[];
}

/**
 * The single mailbox that holds a canonical role for an account (RFC 032
 * exclusive-folder-appointment, #976), in one precedence order every caller
 * shares:
 *
 * 1. the mailbox the user appointed, when it is still one of this account's
 *    mailboxes — an appointment naming a folder that has since been deleted or
 *    renamed, or one carried over from another account, is stale and resolves
 *    on as if unset rather than resolving to nothing;
 * 2. the server's own SPECIAL-USE flag (RFC 6154) — language-independent truth;
 * 3. the reserved `INBOX` name, for the Inbox role only (RFC 3501);
 * 4. a conventional name, matched on the folder's own leaf segment so it
 *    resolves at any depth under any prefix.
 *
 * `null` when nothing matches: the role has no folder, and the caller says so
 * rather than picking one.
 */
export const resolveMailboxForRole = <T extends RoleMailboxCandidate>(
	role: CanonicalMailboxRoleValue,
	mailboxes: readonly T[],
	appointedMailboxId?: string,
): T | null => {
	if (appointedMailboxId) {
		const appointed = mailboxes.find((m) => m.mailboxId === appointedMailboxId);
		if (appointed) return appointed;
	}

	const specialUse = ROLE_SPECIAL_USE[role];
	if (specialUse) {
		const flagged = mailboxes.find((m) => m.specialUse?.includes(specialUse));
		if (flagged) return flagged;
	}

	if (role === CanonicalMailboxRole.Inbox) {
		const inbox = mailboxes.find((m) => m.fullPath.toUpperCase() === "INBOX");
		if (inbox) return inbox;
	}

	const hints = ROLE_NAME_HINTS[role];
	if (!hints) return null;
	return resolveMailboxByLeafName(mailboxes, hints);
};
