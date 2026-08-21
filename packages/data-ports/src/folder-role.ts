import {
	AccountSettingName,
	CanonicalMailboxRole,
	MailboxSpecialUse,
} from "@remit/domain-enums";
import {
	type AccountSettingNameValue,
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
 * The stored `AccountSetting` name holding the path one role's appointed
 * mailbox had at the moment it was appointed. A sibling row rather than a field
 * on the appointment, so "never read by resolution" is structural: the
 * repository composes only the appointment name and cannot reach this one.
 */
export const composeFolderRoleAppointmentLabelName = (
	accountId: string,
	role: CanonicalMailboxRoleValue,
): string =>
	composeSettingName(
		AccountSettingName.FolderRoleAppointmentLabel,
		`${accountId}${SETTING_NAME_SEPARATOR}${role}`,
	);

const parseFolderRoleTarget = (
	base: AccountSettingNameValue,
	name: string,
): { accountId: string; role: CanonicalMailboxRoleValue } | undefined => {
	const [candidate, ...rest] = name.split(SETTING_NAME_SEPARATOR);
	if (candidate !== base) return undefined;
	const role = rest[rest.length - 1];
	const accountId = rest.slice(0, -1).join(SETTING_NAME_SEPARATOR);
	if (!accountId || !role || !isCanonicalRole(role)) return undefined;
	return { accountId, role };
};

/**
 * Split a stored appointment name back into its two-part target. Unlike the
 * single-target composites (`MailboxRole#<id>`), this setting composes two ids
 * after the base, so it parses the suffix itself rather than reusing
 * `targetIdOf`.
 */
export const parseFolderRoleAppointmentName = (
	name: string,
): { accountId: string; role: CanonicalMailboxRoleValue } | undefined =>
	parseFolderRoleTarget(AccountSettingName.FolderRoleAppointment, name);

/**
 * The label row's counterpart, so the config-wide settings batch can recover
 * the recorded path for a role the same way it recovers the appointment.
 */
export const parseFolderRoleAppointmentLabelName = (
	name: string,
): { accountId: string; role: CanonicalMailboxRoleValue } | undefined =>
	parseFolderRoleTarget(AccountSettingName.FolderRoleAppointmentLabel, name);

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
 * What an account with no appointment for the role resolves to, and equally
 * what a stale appointment falls back to — the fallback can never itself be an
 * appointment, stale or otherwise.
 */
export type UnappointedRoleResolution<T> =
	| { kind: "flagged"; mailbox: T }
	| { kind: "reserved"; mailbox: T }
	| { kind: "proposed"; mailbox: T }
	| { kind: "none" };

/**
 * What resolving a role for an account answered, and on what evidence. Total:
 * there is a member for every outcome, so a caller that must weigh the evidence
 * — Empty Trash may only expunge what somebody designated — reads the tag
 * instead of inferring it from a `null` that means four different things.
 *
 * `appointment_stale` is the case a nullable answer cannot express: the user
 * appointed a mailbox the account no longer holds. It carries the id they chose
 * so a surface can offer the repair, and the resolution that would have applied
 * had they appointed nothing.
 */
export type RoleResolution<T> =
	| { kind: "appointed"; mailbox: T }
	| UnappointedRoleResolution<T>
	| {
			kind: "appointment_stale";
			appointedMailboxId: string;
			fallback: UnappointedRoleResolution<T>;
	  };

const resolveWithoutAppointment = <T extends RoleMailboxCandidate>(
	role: CanonicalMailboxRoleValue,
	mailboxes: readonly T[],
): UnappointedRoleResolution<T> => {
	const specialUse = ROLE_SPECIAL_USE[role];
	if (specialUse) {
		const flagged = mailboxes.find((m) => m.specialUse?.includes(specialUse));
		if (flagged) return { kind: "flagged", mailbox: flagged };
	}

	if (role === CanonicalMailboxRole.Inbox) {
		const inbox = mailboxes.find((m) => m.fullPath.toUpperCase() === "INBOX");
		return inbox ? { kind: "reserved", mailbox: inbox } : { kind: "none" };
	}

	const hints = ROLE_NAME_HINTS[role];
	if (!hints) return { kind: "none" };
	const proposed = resolveMailboxByLeafName(mailboxes, hints);
	return proposed ? { kind: "proposed", mailbox: proposed } : { kind: "none" };
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
 */
export const resolveRoleForAccount = <T extends RoleMailboxCandidate>(
	role: CanonicalMailboxRoleValue,
	mailboxes: readonly T[],
	appointedMailboxId?: string,
): RoleResolution<T> => {
	if (!appointedMailboxId) return resolveWithoutAppointment(role, mailboxes);

	const appointed = mailboxes.find((m) => m.mailboxId === appointedMailboxId);
	if (appointed) return { kind: "appointed", mailbox: appointed };

	return {
		kind: "appointment_stale",
		appointedMailboxId,
		fallback: resolveWithoutAppointment(role, mailboxes),
	};
};

/**
 * How much evidence a Trash verb demands. `confirmed` is what an expunge
 * requires: somebody designated this folder, either the user or the server.
 * `resolved` additionally accepts the name guess, for filing mail somewhere the
 * user can retrieve it from. Trash only, deliberately — no other role and no
 * other verb weighs its evidence, and a matrix over eight roles would be five
 * gates nobody asked for.
 */
export type TrashAssuranceLevel = "confirmed" | "resolved";

export const meetsTrashAssurance = <T>(
	resolution: RoleResolution<T>,
	level: TrashAssuranceLevel,
): boolean => {
	switch (resolution.kind) {
		case "appointed":
		case "flagged":
			return true;
		case "proposed":
			return level === "resolved";
		default:
			return false;
	}
};

const withoutStale = <T>(
	resolution: RoleResolution<T>,
): { kind: "appointed"; mailbox: T } | UnappointedRoleResolution<T> =>
	resolution.kind === "appointment_stale" ? resolution.fallback : resolution;

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
	const resolution = withoutStale(
		resolveRoleForAccount(role, mailboxes, appointedMailboxId),
	);
	switch (resolution.kind) {
		case "appointed":
		case "flagged":
		case "reserved":
			return resolution.mailbox;
		default:
			return null;
	}
};

/**
 * The role's mailbox including the name guess: `null` only when nothing
 * matches at all, so the caller says the role has no folder rather than picking
 * one.
 */
export const resolveMailboxForRole = <T extends RoleMailboxCandidate>(
	role: CanonicalMailboxRoleValue,
	mailboxes: readonly T[],
	appointedMailboxId?: string,
): T | null => {
	const resolution = withoutStale(
		resolveRoleForAccount(role, mailboxes, appointedMailboxId),
	);
	return resolution.kind === "none" ? null : resolution.mailbox;
};
