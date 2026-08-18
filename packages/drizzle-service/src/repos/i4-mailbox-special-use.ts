import type {
	IMailboxSpecialUseRepository,
	MailboxSpecialUseItem,
	MailboxSpecialUseValue,
} from "@remit/data-ports";
import {
	type CanonicalMailboxRoleValue,
	composeFolderRoleAppointmentName,
	type RoleMailboxCandidate,
	resolveMailboxForRole,
} from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole } from "@remit/domain-enums";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db.js";
import { randomId } from "../id.js";
import { accountTable } from "../schema/i4-account-config.js";
import { mailboxSpecialUseTable, mailboxTable } from "../schema/i4-mailbox.js";
import { AccountSettingRepo } from "./i4-account-setting.js";

type DB = Db<Record<string, unknown>>;

interface RoleCandidate extends RoleMailboxCandidate {
	fullPath: string;
}

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
	constructor(private db: DB) {}

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

		const setting = await new AccountSettingRepo(this.db).get(
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
