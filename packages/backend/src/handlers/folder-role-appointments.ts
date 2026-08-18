import type { FolderAppointment } from "@remit/api-openapi-types";
import type {
	AccountSettingItem,
	IAccountSettingRepository,
	IMailboxRepository,
} from "@remit/data-ports";
import {
	CANONICAL_ROLES,
	type CanonicalMailboxRoleValue,
	composeFolderRoleAppointmentName,
	parseFolderRoleAppointmentName,
	type RoleMailboxCandidate,
	resolveMailboxForRole,
} from "@remit/data-ports/folder-role";

/**
 * RFC 032 exclusive-folder-appointment (#976): a per-account role→mailbox map.
 * Each row is a `FolderRoleAppointment#<accountId>#<role>` AccountSetting (RFC
 * 032 settings tiers), so a role can never be persisted twice for one account —
 * writing it replaces whichever mailbox previously held it. This module owns
 * that persistence; the read side is `resolveMailboxForRole`
 * (`@remit/data-ports/folder-role`), the same rule every special-folder lookup
 * in the backend and the workers goes through.
 */

export { CANONICAL_ROLES };

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
		const target = parseFolderRoleAppointmentName(setting.name);
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
				composeFolderRoleAppointmentName(accountId, role),
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
	const name = composeFolderRoleAppointmentName(accountId, role);
	if (mailboxId === null) {
		return accountSetting.delete(accountConfigId, name);
	}
	return accountSetting.upsert({
		accountConfigId,
		name,
		value: { kind: "String", value: mailboxId },
	});
};

/**
 * Resolve the full appointment set for one account: the user's persisted
 * choice when set (and still a real mailbox — a deleted mailbox's stale
 * appointment is treated as unfilled and re-proposed), else the server's
 * SPECIAL-USE flag, else a name proposal. Always returns one entry per
 * `CANONICAL_ROLES` member (RFC 032 settings tiers: total, never a sparse
 * array), so the map is never empty for a normal provider.
 */
export const resolveFolderAppointments = (
	persisted: ReadonlyMap<string, string>,
	mailboxes: readonly RoleMailboxCandidate[],
): FolderAppointment[] =>
	CANONICAL_ROLES.map((role) => {
		const found = resolveMailboxForRole(role, mailboxes, persisted.get(role));
		return found ? { role, mailboxId: found.mailboxId } : { role };
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
