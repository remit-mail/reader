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
	// No bare "deleted" and no "bin": both are ordinary folder names a user
	// keeps mail in, and a wrong guess here files deletes into a folder the
	// user never meant as Trash. Gmail's en-GB "Bin" and its "[Gmail]/Trash"
	// both advertise \Trash, so the flag already covers them (#837).
	[CanonicalMailboxRole.Trash]: ["trash", "deleted items", "deleted messages"],
	[CanonicalMailboxRole.All]: ["all mail", "all"],
};

/**
 * The pane where a user appoints a folder to a role, named as it is labelled.
 * Every refusal that asks for an appointment points here, in one wording — the
 * settings screen is titled "Folder roles", and copies of this sentence had
 * already drifted to "Folders".
 */
export const FOLDER_ROLES_SETTINGS_PATH = "Settings › Folder roles";

/**
 * Why an operation that files or destroys mail was refused. A delete, an
 * Empty Trash and the count the handler reports before one all act on the
 * folder the user appointed or the server flagged, and all refuse in these
 * words — one sentence, so two surfaces cannot tell a user two things about
 * one account.
 */
export const NO_TRASH_FOLDER_REASON = `This account has no Trash folder, so nothing was deleted. Appoint one under ${FOLDER_ROLES_SETTINGS_PATH}, then try again.`;

/** The minimal mailbox shape role resolution reads. */
export interface RoleMailboxCandidate extends MailboxNameCandidate {
	specialUse?: readonly string[];
}

/**
 * The mailbox a role is CONFIRMED to hold: the one the user appointed, or the
 * one the server flagged (RFC 6154). No name guessing — `null` here means
 * nobody has said which folder this is, only that a folder happens to be named
 * something plausible. An operation that destroys mail resolves through this
 * and refuses when it comes back empty; `resolveMailboxForRole` adds the guess
 * on top for the operations where being wrong only misfiles a message.
 *
 * An appointment naming a mailbox this account does not hold — deleted,
 * renamed, or carried in from elsewhere — is stale, and falls through to the
 * flag as if unset.
 */
export const resolveConfirmedMailboxForRole = <T extends RoleMailboxCandidate>(
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
		return mailboxes.find((m) => m.fullPath.toUpperCase() === "INBOX") ?? null;
	}

	return null;
};

/**
 * The single mailbox that holds a canonical role for an account (RFC 032
 * exclusive-folder-appointment, #976), in one precedence order every caller
 * shares:
 *
 * 1. the mailbox the user appointed;
 * 2. the server's own SPECIAL-USE flag (RFC 6154) — language-independent truth;
 * 3. the reserved `INBOX` name, for the Inbox role only (RFC 3501);
 * 4. a conventional name, matched on the folder's own leaf segment so it
 *    resolves at any depth under any prefix.
 *
 * The last of those is a guess: a folder named `Deleted` is not evidence that
 * the user means it as Trash. Use it only where being wrong misfiles a message
 * a user can move back — never where it destroys mail.
 *
 * `null` when nothing matches: the role has no folder, and the caller says so
 * rather than picking one.
 */
export const resolveMailboxForRole = <T extends RoleMailboxCandidate>(
	role: CanonicalMailboxRoleValue,
	mailboxes: readonly T[],
	appointedMailboxId?: string,
): T | null => {
	const confirmed = resolveConfirmedMailboxForRole(
		role,
		mailboxes,
		appointedMailboxId,
	);
	if (confirmed) return confirmed;

	const hints = ROLE_NAME_HINTS[role];
	if (!hints) return null;
	return resolveMailboxByLeafName(mailboxes, hints);
};
