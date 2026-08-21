import type { FolderAppointment } from "@remit/api-openapi-types";
import type {
	AccountSettingItem,
	IAccountSettingRepository,
	IMailboxRepository,
} from "@remit/data-ports";
import {
	CANONICAL_ROLES,
	type CanonicalMailboxRoleValue,
	composeFolderRoleAppointmentLabelName,
	composeFolderRoleAppointmentName,
	parseFolderRoleAppointmentLabelName,
	parseFolderRoleAppointmentName,
	type RoleMailboxCandidate,
	type RoleResolution,
	resolveRoleForAccount,
} from "@remit/data-ports/folder-role";
import { FolderAppointmentSource } from "@remit/domain-enums";

/**
 * RFC 032 exclusive-folder-appointment (#976): a per-account role→mailbox map.
 * Each row is a `FolderRoleAppointment#<accountId>#<role>` AccountSetting (RFC
 * 032 settings tiers), so a role can never be persisted twice for one account —
 * writing it replaces whichever mailbox previously held it. This module owns
 * that persistence; the read side is `resolveRoleForAccount`
 * (`@remit/data-ports/folder-role`), the same rule every special-folder lookup
 * in the backend and the workers goes through.
 *
 * A second row, `FolderRoleAppointmentLabel#<accountId>#<role>`, records the
 * path the appointed mailbox had at the time (#887), so a folder another client
 * later deletes can still be named back to the user. It is display only: it
 * lives beside the appointment rather than inside it precisely so the
 * repository that resolves roles composes one name and cannot reach the other.
 */

export { CANONICAL_ROLES };

/** One role's persisted appointment: the choice, plus the path it was made on. */
export interface PersistedFolderAppointment {
	mailboxId: string;
	lastKnownPath?: string;
}

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
): Map<string, Map<string, PersistedFolderAppointment>> => {
	const byAccount = new Map<string, Map<string, PersistedFolderAppointment>>();

	for (const setting of settings) {
		const target = parseFolderRoleAppointmentName(setting.name);
		if (!target) continue;
		const mailboxId = stringValueOf(setting);
		if (mailboxId === undefined) continue;
		const roles =
			byAccount.get(target.accountId) ??
			new Map<string, PersistedFolderAppointment>();
		roles.set(target.role, { mailboxId });
		byAccount.set(target.accountId, roles);
	}

	for (const setting of settings) {
		const target = parseFolderRoleAppointmentLabelName(setting.name);
		if (!target) continue;
		const lastKnownPath = stringValueOf(setting);
		if (lastKnownPath === undefined) continue;
		const appointment = byAccount.get(target.accountId)?.get(target.role);
		if (!appointment) continue;
		appointment.lastKnownPath = lastKnownPath;
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
): Promise<Map<string, PersistedFolderAppointment>> => {
	const entries = await Promise.all(
		CANONICAL_ROLES.map(async (role) => {
			const [appointment, label] = await Promise.all([
				accountSetting.get(
					accountConfigId,
					composeFolderRoleAppointmentName(accountId, role),
				),
				accountSetting.get(
					accountConfigId,
					composeFolderRoleAppointmentLabelName(accountId, role),
				),
			]);
			const mailboxId = appointment ? stringValueOf(appointment) : undefined;
			if (mailboxId === undefined) return [role, undefined] as const;
			const lastKnownPath = label ? stringValueOf(label) : undefined;
			return [
				role,
				lastKnownPath === undefined
					? { mailboxId }
					: { mailboxId, lastKnownPath },
			] as const;
		}),
	);
	const roles = new Map<string, PersistedFolderAppointment>();
	for (const [role, appointment] of entries) {
		if (appointment) roles.set(role, appointment);
	}
	return roles;
};

/**
 * Persist (or clear) one role's appointment. `mailboxId: null` deletes the row
 * — the role goes back to unfilled (RFC 032 settings tiers: absence is unset).
 * A value upserts it, replacing whatever mailbox the role pointed at before;
 * there is no second row a duplicate could live in.
 *
 * The label row moves with it, so a path recorded for a previous choice can
 * never be shown against the current one.
 */
export const writeFolderRoleAppointment = async (
	accountSetting: Pick<IAccountSettingRepository, "upsert" | "delete">,
	accountConfigId: string,
	accountId: string,
	role: CanonicalMailboxRoleValue,
	mailboxId: string | null,
	lastKnownPath?: string,
): Promise<void> => {
	const name = composeFolderRoleAppointmentName(accountId, role);
	const labelName = composeFolderRoleAppointmentLabelName(accountId, role);

	if (mailboxId === null) {
		await accountSetting.delete(accountConfigId, name);
		await accountSetting.delete(accountConfigId, labelName);
		return;
	}

	await accountSetting.upsert({
		accountConfigId,
		name,
		value: { kind: "String", value: mailboxId },
	});

	if (lastKnownPath === undefined) {
		await accountSetting.delete(accountConfigId, labelName);
		return;
	}
	await accountSetting.upsert({
		accountConfigId,
		name: labelName,
		value: { kind: "String", value: lastKnownPath },
	});
};

const SOURCE_BY_KIND: Record<
	"appointed" | "flagged" | "reserved" | "proposed",
	FolderAppointment["source"]
> = {
	appointed: FolderAppointmentSource.Appointed,
	flagged: FolderAppointmentSource.Flagged,
	reserved: FolderAppointmentSource.Reserved,
	proposed: FolderAppointmentSource.Proposed,
};

const toFolderAppointment = (
	role: CanonicalMailboxRoleValue,
	resolution: RoleResolution<RoleMailboxCandidate>,
	lastKnownPath: string | undefined,
): FolderAppointment => {
	if (resolution.kind === "appointment_stale") {
		const { fallback } = resolution;
		return {
			role,
			source: FolderAppointmentSource.Stale,
			mailboxId:
				fallback.kind === "none" ? undefined : fallback.mailbox.mailboxId,
			staleAppointmentMailboxId: resolution.appointedMailboxId,
			staleAppointmentPath: lastKnownPath,
		};
	}
	if (resolution.kind === "none") {
		return { role, source: FolderAppointmentSource.None };
	}
	return {
		role,
		source: SOURCE_BY_KIND[resolution.kind],
		mailboxId: resolution.mailbox.mailboxId,
	};
};

/**
 * Resolve the full appointment set for one account, each entry saying where it
 * came from: the user's persisted choice when set, else the server's
 * SPECIAL-USE flag, else the reserved INBOX name, else a name proposal. A
 * choice naming a mailbox the account no longer holds resolves to whatever the
 * account would have had without it, and says so — the user's decision is
 * surfaced as broken rather than quietly discarded. Always one entry per
 * `CANONICAL_ROLES` member (RFC 032 settings tiers: total, never a sparse
 * array).
 */
export const resolveFolderAppointments = (
	persisted: ReadonlyMap<string, PersistedFolderAppointment>,
	mailboxes: readonly RoleMailboxCandidate[],
): FolderAppointment[] =>
	CANONICAL_ROLES.map((role) => {
		const appointment = persisted.get(role);
		return toFolderAppointment(
			role,
			resolveRoleForAccount(role, mailboxes, appointment?.mailboxId),
			appointment?.lastKnownPath,
		);
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
