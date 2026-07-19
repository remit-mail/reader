import type {
	AccountSettingItem,
	IAccountSettingRepository,
	IMailboxRepository,
} from "@remit/data-ports";
import {
	baseSettingName,
	composeSettingName,
	SETTING_NAME_SEPARATOR,
} from "@remit/data-ports/account-settings";
import {
	AccountSettingName,
	CanonicalMailboxRole,
	MailboxSpecialUse,
} from "@remit/domain-enums";
import type {
	CanonicalMailboxRole as CanonicalMailboxRoleValue,
	FolderAppointment,
} from "@remit/api-openapi-types";

/**
 * RFC 032 exclusive-folder-appointment (#976): a per-account role→mailbox map.
 * Each row is a `FolderRoleAppointment#<accountId>#<role>` AccountSetting (RFC
 * 032 settings tiers), so a role can never be persisted twice for one account —
 * writing it replaces whichever mailbox previously held it. This module owns
 * that persistence plus the read-side proposal (`findFolderForRole`) that fills
 * any role the user hasn't appointed yet.
 */

const FOLDER_ROLE_APPOINTMENT = AccountSettingName.FolderRoleAppointment;

/** The fixed anchor set, in the RFC's canonical display order. */
export const CANONICAL_ROLES: readonly CanonicalMailboxRoleValue[] =
	Object.values(CanonicalMailboxRole);

const composeAppointmentName = (
	accountId: string,
	role: CanonicalMailboxRoleValue,
): string =>
	composeSettingName(
		FOLDER_ROLE_APPOINTMENT,
		`${accountId}${SETTING_NAME_SEPARATOR}${role}`,
	);

/**
 * Split a stored `FolderRoleAppointment#<accountId>#<role>` name back into its
 * two-part target. Unlike the single-target composites (`MailboxRole#<id>`),
 * this setting composes two ids after the base, so it parses the suffix itself
 * rather than reusing `targetIdOf`.
 */
const parseAppointmentTarget = (
	name: string,
): { accountId: string; role: string } | undefined => {
	if (baseSettingName(name) !== FOLDER_ROLE_APPOINTMENT) return undefined;
	const idx = name.indexOf(SETTING_NAME_SEPARATOR);
	if (idx === -1) return undefined;
	const rest = name.slice(idx + SETTING_NAME_SEPARATOR.length);
	const roleIdx = rest.lastIndexOf(SETTING_NAME_SEPARATOR);
	if (roleIdx === -1) return undefined;
	const accountId = rest.slice(0, roleIdx);
	const role = rest.slice(roleIdx + SETTING_NAME_SEPARATOR.length);
	if (!accountId || !role) return undefined;
	return { accountId, role };
};

const stringValueOf = (item: AccountSettingItem): string | undefined => {
	const { value } = item;
	return value.kind === "String" ? value.value : undefined;
};

/**
 * Group every persisted folder-role appointment in one config-wide settings
 * read (e.g. GET /config's already-loaded `listByAccountConfig` result) by
 * accountId, then by role. Mirrors `groupAccountOverrides` / `groupMailboxOverrides`.
 */
export const groupFolderAppointmentsByAccount = (
	settings: AccountSettingItem[],
): Map<string, Map<string, string>> => {
	const byAccount = new Map<string, Map<string, string>>();
	for (const setting of settings) {
		const target = parseAppointmentTarget(setting.name);
		if (!target) continue;
		const mailboxId = stringValueOf(setting);
		if (mailboxId === undefined) continue;
		const roles = byAccount.get(target.accountId) ?? new Map<string, string>();
		roles.set(target.role, mailboxId);
		byAccount.set(target.accountId, roles);
	}
	return byAccount;
};

/**
 * Load one account's persisted appointments by reading each role's row
 * directly (mirrors `loadMailboxOverrides`'s three-get pattern). Used by the
 * create/update account handlers, which only ever need a single account.
 */
export const loadFolderAppointmentsForAccount = async (
	accountSetting: Pick<IAccountSettingRepository, "get">,
	accountConfigId: string,
	accountId: string,
): Promise<Map<string, string>> => {
	const entries = await Promise.all(
		CANONICAL_ROLES.map(async (role) => {
			const item = await accountSetting.get(
				accountConfigId,
				composeAppointmentName(accountId, role),
			);
			return [role, item ? stringValueOf(item) : undefined] as const;
		}),
	);
	const roles = new Map<string, string>();
	for (const [role, mailboxId] of entries) {
		if (mailboxId !== undefined) roles.set(role, mailboxId);
	}
	return roles;
};

/**
 * Persist (or clear) one role's appointment. `mailboxId: null` deletes the row
 * — the role goes back to unfilled (RFC 032 settings tiers: absence is unset).
 * A value upserts it, replacing whatever mailbox the role pointed at before;
 * there is no second row a duplicate could live in.
 */
export const writeFolderRoleAppointment = (
	accountSetting: Pick<IAccountSettingRepository, "upsert" | "delete">,
	accountConfigId: string,
	accountId: string,
	role: CanonicalMailboxRoleValue,
	mailboxId: string | null,
): Promise<unknown> => {
	const name = composeAppointmentName(accountId, role);
	if (mailboxId === null) {
		return accountSetting.delete(accountConfigId, name);
	}
	return accountSetting.upsert({
		accountConfigId,
		name,
		value: { kind: "String", value: mailboxId },
	});
};

/** The minimal folder shape `findFolderForRole` needs to detect a role. */
export interface FolderCandidate {
	mailboxId: string;
	fullPath: string;
	specialUse?: readonly string[];
}

// RFC 6154 SPECIAL-USE flag per role. Inbox has no SPECIAL-USE flag (RFC 3501
// reserves the name itself); a role with no entry here is matched by name hint
// only.
const ROLE_TO_SPECIAL_USE: Partial<Record<CanonicalMailboxRoleValue, string>> =
	{
		[CanonicalMailboxRole.Drafts]: MailboxSpecialUse.Drafts,
		[CanonicalMailboxRole.Sent]: MailboxSpecialUse.Sent,
		[CanonicalMailboxRole.Archive]: MailboxSpecialUse.Archive,
		[CanonicalMailboxRole.Junk]: MailboxSpecialUse.Junk,
		[CanonicalMailboxRole.Trash]: MailboxSpecialUse.Trash,
		[CanonicalMailboxRole.All]: MailboxSpecialUse.All,
		[CanonicalMailboxRole.Flagged]: MailboxSpecialUse.Flagged,
	};

// Weak name hints (RFC 032's tier 3 of `findFolderForRole`): used solely to
// seed a PROPOSAL a human confirms, never to persist a role by itself. Kept
// intentionally small — this is a fallback for providers with no SPECIAL-USE
// support, not a substitute for server truth.
const ROLE_NAME_HINTS: Partial<
	Record<CanonicalMailboxRoleValue, readonly string[]>
> = {
	[CanonicalMailboxRole.Drafts]: ["drafts", "draft", "concepten"],
	[CanonicalMailboxRole.Sent]: [
		"sent",
		"sent mail",
		"sent items",
		"sent messages",
	],
	[CanonicalMailboxRole.Archive]: ["archive", "archives"],
	[CanonicalMailboxRole.Junk]: ["junk", "spam"],
	[CanonicalMailboxRole.Trash]: [
		"trash",
		"bin",
		"deleted",
		"deleted items",
		"deleted messages",
	],
	[CanonicalMailboxRole.All]: ["all mail", "all"],
};

const leafName = (fullPath: string): string => {
	const parts = fullPath.split("/");
	return (parts[parts.length - 1] || fullPath).toLowerCase();
};

/**
 * The single best EXISTING folder for a canonical role (RFC 032
 * exclusive-folder-appointment): the IMAP SPECIAL-USE flag first (server
 * truth, language-independent), then — for Inbox only — the reserved `INBOX`
 * name (RFC 3501), then a weak name hint used solely to seed a proposal a
 * human confirms. `null` when nothing matches; the role stays unfilled.
 */
export const findFolderForRole = (
	role: CanonicalMailboxRoleValue,
	folders: readonly FolderCandidate[],
): string | null => {
	const specialUse = ROLE_TO_SPECIAL_USE[role];
	if (specialUse) {
		const flagged = folders.find((f) => f.specialUse?.includes(specialUse));
		if (flagged) return flagged.mailboxId;
	}

	if (role === CanonicalMailboxRole.Inbox) {
		const inbox = folders.find((f) => f.fullPath.toUpperCase() === "INBOX");
		if (inbox) return inbox.mailboxId;
	}

	const hints = ROLE_NAME_HINTS[role];
	if (hints) {
		const match = folders.find((f) => hints.includes(leafName(f.fullPath)));
		if (match) return match.mailboxId;
	}

	return null;
};

/**
 * Resolve the full appointment set for one account: the user's persisted
 * choice when set (and still a real mailbox — a deleted mailbox's stale
 * appointment is treated as unfilled and re-proposed), else a server-proposed
 * `findFolderForRole` guess. Always returns one entry per `CANONICAL_ROLES`
 * member (RFC 032 settings tiers: total, never a sparse array), so the map is
 * never empty for a normal provider.
 */
export const resolveFolderAppointments = (
	persisted: ReadonlyMap<string, string>,
	mailboxes: readonly FolderCandidate[],
): FolderAppointment[] =>
	CANONICAL_ROLES.map((role) => {
		const persistedId = persisted.get(role);
		const validPersisted =
			persistedId && mailboxes.some((m) => m.mailboxId === persistedId)
				? persistedId
				: undefined;
		const mailboxId =
			validPersisted ?? findFolderForRole(role, mailboxes) ?? undefined;
		return mailboxId ? { role, mailboxId } : { role };
	});

/**
 * End-to-end resolution for one account: load its persisted appointments and
 * its mailboxes, then resolve. The single entry point every handler that
 * builds an AccountResponse calls (create/update account, GET /config's
 * per-account fan-out mirrors this with a pre-loaded settings batch instead —
 * see `groupFolderAppointmentsByAccount` — to avoid an N+1 settings read).
 */
export const resolveAccountFolderAppointments = async (
	client: {
		mailbox: Pick<IMailboxRepository, "listAllByAccount">;
		accountSetting: Pick<IAccountSettingRepository, "get">;
	},
	accountConfigId: string,
	accountId: string,
): Promise<FolderAppointment[]> => {
	const [persisted, mailboxes] = await Promise.all([
		loadFolderAppointmentsForAccount(
			client.accountSetting,
			accountConfigId,
			accountId,
		),
		client.mailbox.listAllByAccount(accountId),
	]);
	return resolveFolderAppointments(persisted, mailboxes);
};
