import {
	AccountSettingName,
	CanonicalMailboxRole,
	FolderAppointmentSource,
	MailboxSpecialUse,
} from "@remit/domain-enums";
import {
	type AccountSettingNameValue,
	composeSettingName,
	SETTING_NAME_SEPARATOR,
} from "./account-settings.js";
import {
	type MailboxNameCandidate,
	mailboxLeafName,
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
 * Conventional names, ordered best-first, in lower case and NFC. An exact
 * match is detected only when unique in the account and at the root or directly
 * under INBOX; otherwise the best-ranked match remains a proposal.
 */
export const ROLE_NAME_HINTS: Partial<
	Record<CanonicalMailboxRoleValue, readonly string[]>
> = {
	[CanonicalMailboxRole.Drafts]: [
		"drafts",
		"draft",
		"concepten",
		"entwürfe",
		"brouillons",
		"borradores",
		"bozze",
		"rascunhos",
	],
	[CanonicalMailboxRole.Sent]: [
		"sent",
		"sent items",
		"sent messages",
		"sent mail",
		"verzonden",
		"verzonden items",
		"verzonden berichten",
		"gesendet",
		"gesendete elemente",
		"gesendete objekte",
		"gesendete nachrichten",
		"envoyés",
		"éléments envoyés",
		"messages envoyés",
		"enviados",
		"elementos enviados",
		"mensajes enviados",
		"posta inviata",
		"inviati",
		"messaggi inviati",
		"itens enviados",
		"mensagens enviadas",
	],
	[CanonicalMailboxRole.Archive]: [
		"archive",
		"archives",
		"archief",
		"archiv",
		"archivo",
		"archivos",
		"archivio",
		"archivi",
		"arquivo",
		"arquivos",
	],
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
	[CanonicalMailboxRole.Trash]: [
		"trash",
		"deleted items",
		"deleted messages",
		"prullenbak",
		"verwijderde items",
		"verwijderde berichten",
		"papierkorb",
		"gelöschte elemente",
		"gelöschte objekte",
		"gelöschte nachrichten",
		"corbeille",
		"éléments supprimés",
		"messages supprimés",
		"papelera",
		"elementos eliminados",
		"mensajes eliminados",
		"cestino",
		"posta eliminata",
		"messaggi eliminati",
		"lixeira",
		"lixo",
		"itens excluídos",
		"mensagens excluídas",
		"itens eliminados",
		"mensagens eliminadas",
	],
	[CanonicalMailboxRole.All]: ["all mail", "all"],
};

/**
 * The role a folder's own leaf name is most conventionally for. A name that
 * several roles list goes to the role that ranks it highest, so `All Mail` is
 * an All folder rather than a lookalike of Archive.
 *
 * `name` is the leaf segment, lower case.
 */
export const roleForFolderName = (
	name: string,
): CanonicalMailboxRoleValue | undefined => {
	let best: { role: CanonicalMailboxRoleValue; rank: number } | undefined;
	for (const role of CANONICAL_ROLES) {
		const rank = ROLE_NAME_HINTS[role]?.indexOf(name) ?? -1;
		if (rank < 0) continue;
		if (!best || rank < best.rank) best = { role, rank };
	}
	return best?.role;
};

/**
 * Conventional system-folder names protected by label creation and MCP
 * deletion. This is not a projection filter or a rename restriction: every
 * selectable folder stays listed, even beside a flagged folder for the role.
 */
export const isReservedFolderName = (name: string): boolean => {
	const role = roleForFolderName(name.normalize("NFC").toLowerCase());
	return role !== undefined && ROLE_SPECIAL_USE[role] !== undefined;
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

/**
 * The folder somebody chose as this account's Trash is no longer on the mail
 * server. Reader will not quietly file mail into whatever it would have picked
 * had nobody chosen: the user's choice went missing and only they can replace
 * it.
 */
export const STALE_TRASH_FOLDER_REASON = `The folder appointed as this account's Trash is no longer on the mail server, so nothing was deleted. Appoint one under ${FOLDER_ROLES_SETTINGS_PATH}, then try again.`;

/**
 * Multiple folders match the Trash name hints (or the match is nested outside
 * INBOX) — enough to file a delete somewhere retrievable, never enough to
 * erase what is already in it.
 * Emptying that folder and deleting a message already inside it both land here
 * (#876), so the sentence names neither verb: "nothing was deleted" is true of
 * both, the way its two siblings above are.
 */
export const UNCONFIRMED_TRASH_FOLDER_REASON = `Nobody has confirmed which folder is this account's Trash, so nothing was deleted. Appoint one under ${FOLDER_ROLES_SETTINGS_PATH}, then try again.`;

/**
 * The mailboxes holding Junk and Trash across a set of accounts, as ids. The
 * shape a SQL predicate needs when it must ask "is this message in Junk"
 * without spelling the rule a second time: resolution happens once, here, and
 * SQL compares mailbox ids.
 *
 * A role resolves to at most one mailbox per account, so each list holds one id
 * per account that has that folder — and no entry at all for an account that
 * has none.
 */
export interface JunkRoleMailboxes {
	readonly junkMailboxIds: readonly string[];
	readonly trashMailboxIds: readonly string[];
}

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
	| { kind: "detected"; mailbox: T }
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
	if (!proposed) return { kind: "none" };
	const candidates = mailboxes.filter((m) =>
		hints.includes(mailboxLeafName(m).normalize("NFC").toLowerCase()),
	);
	const parts = proposed.hierarchyDelimiter
		? proposed.fullPath.split(proposed.hierarchyDelimiter)
		: [proposed.fullPath];
	const conventionalLocation =
		parts.length === 1 ||
		(parts.length === 2 && parts[0]?.toUpperCase() === "INBOX");
	return {
		kind:
			candidates.length === 1 && conventionalLocation ? "detected" : "proposed",
		mailbox: proposed,
	};
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
 * A unique exact name at the root or directly under INBOX is detected. Multiple
 * candidates or other locations remain proposals, never expunge evidence.
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
 * requires: an appointment, a server flag, or an unambiguous detected name.
 * `resolved` additionally accepts the name guess, for filing mail somewhere the
 * user can retrieve it from. Trash only, deliberately — no other role and no
 * other verb weighs its evidence, and a matrix over eight roles would be five
 * gates nobody asked for.
 */
export type TrashAssuranceLevel = "confirmed" | "resolved";

/**
 * Why a canonical role names no folder an action may act on. `none`: the
 * account has no candidate at all. `stale`: the folder the user appointed is
 * gone from the server. `unconfirmed`: only an ambiguous or unconventionally
 * nested name matches; no appointment, flag or unambiguous detection applies.
 * These three and no others; a target that is merely unsettled is a different
 * refusal under its own code.
 */
export type FolderRoleUnresolvedReason = "none" | "stale" | "unconfirmed";

export type TrashGateOutcome<T> =
	| { allowed: true; mailbox: T }
	| { allowed: false; reason: FolderRoleUnresolvedReason };

/**
 * The Trash folder a verb at this assurance level may act on, or which of the
 * three reasons stops it. One switch: the delete, the expunge and the count
 * reported before one all decide here, so no two of them can answer a user
 * differently about the same account.
 */
export const trashMailboxAt = <T>(
	resolution: RoleResolution<T>,
	level: TrashAssuranceLevel,
): TrashGateOutcome<T> => {
	switch (resolution.kind) {
		case "appointed":
		case "flagged":
		case "detected":
			return { allowed: true, mailbox: resolution.mailbox };
		case "proposed":
			return level === "resolved"
				? { allowed: true, mailbox: resolution.mailbox }
				: { allowed: false, reason: "unconfirmed" };
		case "appointment_stale":
			return { allowed: false, reason: "stale" };
		default:
			return { allowed: false, reason: "none" };
	}
};

export const meetsTrashAssurance = <T>(
	resolution: RoleResolution<T>,
	level: TrashAssuranceLevel,
): boolean => trashMailboxAt(resolution, level).allowed;

export type FolderAppointmentSourceValue =
	(typeof FolderAppointmentSource)[keyof typeof FolderAppointmentSource];

/** The resolution each reported source came from (`toFolderAppointment`). */
const RESOLUTION_FOR_SOURCE: Record<
	FolderAppointmentSourceValue,
	RoleResolution<null>
> = {
	[FolderAppointmentSource.Appointed]: { kind: "appointed", mailbox: null },
	[FolderAppointmentSource.Flagged]: { kind: "flagged", mailbox: null },
	[FolderAppointmentSource.Reserved]: { kind: "reserved", mailbox: null },
	[FolderAppointmentSource.Detected]: { kind: "detected", mailbox: null },
	[FolderAppointmentSource.Proposed]: { kind: "proposed", mailbox: null },
	[FolderAppointmentSource.Stale]: {
		kind: "appointment_stale",
		appointedMailboxId: "",
		fallback: { kind: "none" },
	},
	[FolderAppointmentSource.None]: { kind: "none" },
};

/**
 * The same gate as {@link trashMailboxAt}, asked of the source `/config`
 * reports rather than of the resolution the server computed — so a client can
 * word a delete from the answer the service will give it.
 *
 * It runs that switch rather than restating it. A hand-written mirror gets
 * `Reserved` wrong: it reads as designated, and the gate accepts only the user's
 * appointment, server flag and unique detected name.
 */
export const trashSourceMeetsAssurance = (
	source: FolderAppointmentSourceValue,
	level: TrashAssuranceLevel,
): boolean => meetsTrashAssurance(RESOLUTION_FOR_SOURCE[source], level);

/**
 * The mailbox confirmed by appointment, server flag, reserved INBOX or a
 * unique conventional name at the root or directly under INBOX. Ambiguous
 * proposals do not authorize destructive operations.
 *
 * An appointment naming a mailbox this account does not hold — deleted,
 * renamed, or carried in from elsewhere — is stale, and answers `null` here
 * too: the fallback is the folder the user did not choose, which is fine to
 * file mail into and no basis at all for destroying it.
 */
export const resolveConfirmedMailboxForRole = <T extends RoleMailboxCandidate>(
	role: CanonicalMailboxRoleValue,
	mailboxes: readonly T[],
	appointedMailboxId?: string,
): T | null => {
	const resolution = resolveRoleForAccount(role, mailboxes, appointedMailboxId);
	switch (resolution.kind) {
		case "appointed":
		case "flagged":
		case "detected":
		case "reserved":
			return resolution.mailbox;
		default:
			return null;
	}
};

/**
 * The role's mailbox including the name guess: `null` only when nothing
 * matches at all, so the caller says the role has no folder rather than picking
 * one. A stale appointment answers with its fallback — every role but Trash
 * files mail on this read, and refusing them all would be a behaviour change
 * with no surface to explain it.
 *
 * Built on `resolveRoleForAccount` directly, never on the confirmed adapter: a
 * stale appointment must still reach the `\Sent` flag here, not fall past it
 * into a folder that merely reads like one.
 */
export const resolveMailboxForRole = <T extends RoleMailboxCandidate>(
	role: CanonicalMailboxRoleValue,
	mailboxes: readonly T[],
	appointedMailboxId?: string,
): T | null => {
	const resolution = resolveRoleForAccount(role, mailboxes, appointedMailboxId);
	const effective =
		resolution.kind === "appointment_stale" ? resolution.fallback : resolution;
	return effective.kind === "none" ? null : effective.mailbox;
};
