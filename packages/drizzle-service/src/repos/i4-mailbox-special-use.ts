import type {
	AccountSettingValue,
	IMailboxSpecialUseRepository,
	MailboxSpecialUseItem,
	MailboxSpecialUseValue,
} from "@remit/data-ports";
import {
	type CanonicalMailboxRoleValue,
	composeFolderRoleAppointmentName,
	type JunkRoleMailboxes,
	type RoleMailboxCandidate,
	type RoleResolution,
	resolveMailboxForRole,
	resolveRoleForAccount,
	type UnappointedRoleResolution,
} from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole } from "@remit/domain-enums";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db.js";
import { randomId } from "../id.js";
import { accountTable } from "../schema/i4-account-config.js";
import { accountSettingTable } from "../schema/i4-account-setting.js";
import { mailboxSpecialUseTable, mailboxTable } from "../schema/i4-mailbox.js";
import { AccountSettingRepo } from "./i4-account-setting.js";

type DB = Db<Record<string, unknown>>;

const JUNK_ROLES: readonly CanonicalMailboxRoleValue[] = [
	CanonicalMailboxRole.Junk,
	CanonicalMailboxRole.Trash,
];

const appointmentKey = (
	accountId: string,
	role: CanonicalMailboxRoleValue,
): string => `${accountId}\u0000${role}`;

interface RoleCandidate extends RoleMailboxCandidate {
	fullPath: string;
}

interface RoleMailbox {
	mailboxId: string;
	fullPath: string;
}

const projectMailbox = (candidate: RoleCandidate): RoleMailbox => ({
	mailboxId: candidate.mailboxId,
	fullPath: candidate.fullPath,
});

const projectUnappointed = (
	resolution: UnappointedRoleResolution<RoleCandidate>,
): UnappointedRoleResolution<RoleMailbox> =>
	resolution.kind === "none"
		? resolution
		: { kind: resolution.kind, mailbox: projectMailbox(resolution.mailbox) };

const projectResolution = (
	resolution: RoleResolution<RoleCandidate>,
): RoleResolution<RoleMailbox> => {
	if (resolution.kind === "appointment_stale") {
		return {
			kind: "appointment_stale",
			appointedMailboxId: resolution.appointedMailboxId,
			fallback: projectUnappointed(resolution.fallback),
		};
	}
	if (resolution.kind === "appointed") {
		return { kind: "appointed", mailbox: projectMailbox(resolution.mailbox) };
	}
	return projectUnappointed(resolution);
};

function rowToSpecialUse(
	row: typeof mailboxSpecialUseTable.$inferSelect,
): MailboxSpecialUseItem {
	return {
		mailboxSpecialUseId: row.mailboxSpecialUseId,
		mailboxId: row.mailboxId,
		specialUse: row.specialUse as MailboxSpecialUseValue,
	};
}

export class MailboxSpecialUseRepo implements IMailboxSpecialUseRepository {
	private readonly accountSetting: AccountSettingRepo;

	constructor(private db: DB) {
		this.accountSetting = new AccountSettingRepo(db);
	}

	async create(
		mailboxId: string,
		specialUse: MailboxSpecialUseValue,
	): Promise<MailboxSpecialUseItem> {
		const [row] = await this.db
			.insert(mailboxSpecialUseTable)
			.values({
				mailboxSpecialUseId: randomId(),
				mailboxId,
				specialUse,
			})
			.returning();
		return rowToSpecialUse(row);
	}

	async createMany(
		mailboxId: string,
		specialUses: MailboxSpecialUseValue[],
	): Promise<MailboxSpecialUseItem[]> {
		if (specialUses.length === 0) return [];
		const values = specialUses.map((specialUse) => ({
			mailboxSpecialUseId: randomId(),
			mailboxId,
			specialUse,
		}));
		const rows = await this.db
			.insert(mailboxSpecialUseTable)
			.values(values)
			.returning();
		return rows.map(rowToSpecialUse);
	}

	async listByMailboxId(mailboxId: string): Promise<MailboxSpecialUseItem[]> {
		const rows = await this.db
			.select()
			.from(mailboxSpecialUseTable)
			.where(eq(mailboxSpecialUseTable.mailboxId, mailboxId));
		return rows.map(rowToSpecialUse);
	}

	async deleteByMailboxId(mailboxId: string): Promise<number> {
		const existing = await this.listByMailboxId(mailboxId);
		if (existing.length === 0) return 0;
		await this.db
			.delete(mailboxSpecialUseTable)
			.where(eq(mailboxSpecialUseTable.mailboxId, mailboxId));
		return existing.length;
	}

	findInboxMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		return this.findMailboxForRole(accountId, CanonicalMailboxRole.Inbox);
	}

	findSentMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		return this.findMailboxForRole(accountId, CanonicalMailboxRole.Sent);
	}

	findTrashMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		return this.findMailboxForRole(accountId, CanonicalMailboxRole.Trash);
	}

	/**
	 * Trash with its evidence, for the verbs that weigh it. Reads exactly what
	 * `findMailboxForRole` reads — a `null` answer is thrown away there, and this
	 * keeps it.
	 */
	async resolveTrashRole(
		accountId: string,
	): Promise<RoleResolution<RoleMailbox>> {
		const role = CanonicalMailboxRole.Trash;
		const [candidates, appointedMailboxId] = await Promise.all([
			this.roleCandidates(accountId),
			this.appointedMailboxId(accountId, role),
		]);
		return projectResolution(
			resolveRoleForAccount(role, candidates, appointedMailboxId),
		);
	}

	findArchiveMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		return this.findMailboxForRole(accountId, CanonicalMailboxRole.Archive);
	}

	findJunkMailbox(
		accountId: string,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		return this.findMailboxForRole(accountId, CanonicalMailboxRole.Junk);
	}

	/**
	 * Junk and Trash for every account under one config, in a fixed number of
	 * reads however many accounts the config holds — this feeds a predicate the
	 * per-message reconcile runs inside the sync loop.
	 */
	async resolveJunkRolesForConfig(
		accountConfigId: string,
	): Promise<JunkRoleMailboxes> {
		const accounts = await this.db
			.select({ accountId: accountTable.accountId })
			.from(accountTable)
			.where(eq(accountTable.accountConfigId, accountConfigId));
		return this.resolveJunkRoles(accounts.map((row) => row.accountId));
	}

	/**
	 * The same answer for every account the instance holds. A mailbox id belongs
	 * to exactly one account, so a union across accounts is no less selective
	 * than asking each of them separately — which is what lets the boot sweep
	 * run one pass over the address table instead of one per config.
	 */
	async resolveJunkRolesForInstance(): Promise<JunkRoleMailboxes> {
		const accounts = await this.db
			.select({ accountId: accountTable.accountId })
			.from(accountTable);
		return this.resolveJunkRoles(accounts.map((row) => row.accountId));
	}

	private async resolveJunkRoles(
		accountIds: readonly string[],
	): Promise<JunkRoleMailboxes> {
		if (accountIds.length === 0) {
			return { junkMailboxIds: [], trashMailboxIds: [] };
		}
		const [candidates, appointments] = await Promise.all([
			this.roleCandidatesFor(accountIds),
			this.appointedMailboxIds(accountIds, JUNK_ROLES),
		]);

		const junkMailboxIds: string[] = [];
		const trashMailboxIds: string[] = [];
		for (const accountId of accountIds) {
			const mailboxes = candidates.get(accountId) ?? [];
			const junk = resolveMailboxForRole(
				CanonicalMailboxRole.Junk,
				mailboxes,
				appointments.get(appointmentKey(accountId, CanonicalMailboxRole.Junk)),
			);
			if (junk) junkMailboxIds.push(junk.mailboxId);
			const trash = resolveMailboxForRole(
				CanonicalMailboxRole.Trash,
				mailboxes,
				appointments.get(appointmentKey(accountId, CanonicalMailboxRole.Trash)),
			);
			if (trash) trashMailboxIds.push(trash.mailboxId);
		}
		return { junkMailboxIds, trashMailboxIds };
	}

	/**
	 * Each account's appointment for each role, in two reads. Same precedence
	 * input as `appointedMailboxId`, batched: an account row missing is a caller
	 * racing a delete, and leaves the account with no appointment rather than
	 * failing the lookup.
	 */
	private async appointedMailboxIds(
		accountIds: readonly string[],
		roles: readonly CanonicalMailboxRoleValue[],
	): Promise<Map<string, string>> {
		const accounts = await this.db
			.select({
				accountId: accountTable.accountId,
				accountConfigId: accountTable.accountConfigId,
			})
			.from(accountTable)
			.where(inArray(accountTable.accountId, [...accountIds]));
		if (accounts.length === 0) return new Map();

		const wanted = new Map<string, string>();
		for (const account of accounts) {
			for (const role of roles) {
				wanted.set(
					composeFolderRoleAppointmentName(account.accountId, role),
					appointmentKey(account.accountId, role),
				);
			}
		}

		const rows = await this.db
			.select({
				name: accountSettingTable.name,
				value: accountSettingTable.value,
			})
			.from(accountSettingTable)
			.where(
				and(
					inArray(
						accountSettingTable.accountConfigId,
						accounts.map((account) => account.accountConfigId),
					),
					inArray(accountSettingTable.name, [...wanted.keys()]),
				),
			);

		const appointed = new Map<string, string>();
		for (const row of rows) {
			const key = wanted.get(row.name);
			if (!key) continue;
			const value = row.value as AccountSettingValue;
			if (value.kind !== "String") continue;
			appointed.set(key, value.value);
		}
		return appointed;
	}

	private async roleCandidatesFor(
		accountIds: readonly string[],
	): Promise<Map<string, RoleCandidate[]>> {
		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(inArray(mailboxTable.accountId, [...accountIds]));
		if (rows.length === 0) return new Map();

		const entries = await this.db
			.select()
			.from(mailboxSpecialUseTable)
			.where(
				inArray(
					mailboxSpecialUseTable.mailboxId,
					rows.map((row) => row.mailboxId),
				),
			);
		const byMailbox = new Map<string, string[]>();
		for (const entry of entries) {
			const designations = byMailbox.get(entry.mailboxId) ?? [];
			designations.push(entry.specialUse);
			byMailbox.set(entry.mailboxId, designations);
		}

		const byAccount = new Map<string, RoleCandidate[]>();
		for (const row of rows) {
			const candidates = byAccount.get(row.accountId) ?? [];
			candidates.push({
				mailboxId: row.mailboxId,
				fullPath: row.fullPath,
				hierarchyDelimiter: row.hierarchyDelimiter,
				specialUse: byMailbox.get(row.mailboxId) ?? [],
			});
			byAccount.set(row.accountId, candidates);
		}
		return byAccount;
	}

	/**
	 * The one read behind every `find<Role>Mailbox`: the account's mailboxes and
	 * its appointment for this role, handed to the shared precedence rule. Read
	 * fresh each time — the appointment is a single indexed row next to reads
	 * this path already makes, and a cache would leave a role the user just
	 * re-appointed in the UI pointing at the old folder until it expired.
	 */
	private async findMailboxForRole(
		accountId: string,
		role: CanonicalMailboxRoleValue,
	): Promise<{ mailboxId: string; fullPath: string } | null> {
		const [candidates, appointedMailboxId] = await Promise.all([
			this.roleCandidates(accountId),
			this.appointedMailboxId(accountId, role),
		]);
		const found = resolveMailboxForRole(role, candidates, appointedMailboxId);
		return found
			? { mailboxId: found.mailboxId, fullPath: found.fullPath }
			: null;
	}

	/**
	 * `undefined` whenever the account has no appointment for the role — and
	 * equally when the account row itself is gone, which is a caller racing a
	 * delete rather than a reason to fail a lookup the proposal can still answer.
	 */
	private async appointedMailboxId(
		accountId: string,
		role: CanonicalMailboxRoleValue,
	): Promise<string | undefined> {
		const [account] = await this.db
			.select({ accountConfigId: accountTable.accountConfigId })
			.from(accountTable)
			.where(eq(accountTable.accountId, accountId));
		if (!account) return undefined;

		const setting = await this.accountSetting.get(
			account.accountConfigId,
			composeFolderRoleAppointmentName(accountId, role),
		);
		if (!setting || setting.value.kind !== "String") return undefined;
		return setting.value.value;
	}

	/**
	 * The account's mailboxes with their SPECIAL-USE designations attached. The
	 * designations come from `mailboxSpecialUseEntry` rather than the mailbox
	 * row's denormalized column, because that entry table is what `create` and
	 * `createMany` here write.
	 */
	private async roleCandidates(accountId: string): Promise<RoleCandidate[]> {
		const rows = await this.db
			.select()
			.from(mailboxTable)
			.where(eq(mailboxTable.accountId, accountId));
		if (rows.length === 0) return [];

		const entries = await this.db
			.select()
			.from(mailboxSpecialUseTable)
			.where(
				inArray(
					mailboxSpecialUseTable.mailboxId,
					rows.map((row) => row.mailboxId),
				),
			);
		const byMailbox = new Map<string, string[]>();
		for (const entry of entries) {
			const designations = byMailbox.get(entry.mailboxId) ?? [];
			designations.push(entry.specialUse);
			byMailbox.set(entry.mailboxId, designations);
		}

		return rows.map((row) => ({
			mailboxId: row.mailboxId,
			fullPath: row.fullPath,
			hierarchyDelimiter: row.hierarchyDelimiter,
			specialUse: byMailbox.get(row.mailboxId) ?? [],
		}));
	}
}
