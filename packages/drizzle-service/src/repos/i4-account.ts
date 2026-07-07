import type {
	AccountDescription,
	AccountItem,
	CreateAccountInput,
	IAccountRepository,
	ResultList,
	UpdateAccountInput,
} from "@remit/data-ports";
import { SyncPhase } from "@remit/domain-enums";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { decodeToken, resultList } from "../pagination.js";
import { accountTable } from "../schema/i4-account-config.js";
import { mailboxTable } from "../schema/i4-mailbox.js";
import { rowToMailbox } from "./i4-mailbox.js";

type DB = NodePgDatabase<Record<string, unknown>>;

export function rowToAccount(
	row: typeof accountTable.$inferSelect,
): AccountItem {
	return {
		accountId: row.accountId,
		accountConfigId: row.accountConfigId,
		username: row.username,
		email: row.email,
		authType: row.authType as AccountItem["authType"],
		passwordHash: row.passwordHash ?? undefined,
		oauthRefreshTokenHash: row.oauthRefreshTokenHash ?? undefined,
		oauthTokenUpdatedAt: row.oauthTokenUpdatedAt ?? undefined,
		imapHost: row.imapHost,
		imapPort: row.imapPort,
		imapTls: row.imapTls,
		imapStartTls: row.imapStartTls,
		smtpEnabled: row.smtpEnabled,
		smtpHost: row.smtpHost,
		smtpPort: row.smtpPort,
		smtpTls: row.smtpTls,
		smtpStartTls: row.smtpStartTls,
		smtpUsername: row.smtpUsername,
		smtpPasswordHash: row.smtpPasswordHash ?? undefined,
		isActive: row.isActive,
		connectionState: row.connectionState as AccountItem["connectionState"],
		lastConnectedAt: row.lastConnectedAt ?? undefined,
		lastSyncAt: row.lastSyncAt ?? undefined,
		lastError: row.lastError ?? undefined,
		syncPhase: (row.syncPhase as AccountItem["syncPhase"]) ?? undefined,
		mailboxCountTotal: row.mailboxCountTotal ?? undefined,
		mailboxCountSynced: row.mailboxCountSynced ?? undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt ?? undefined,
	};
}

export class AccountRepo implements IAccountRepository {
	constructor(private db: DB) {}

	async create(input: CreateAccountInput): Promise<AccountItem> {
		const now = Date.now();
		const accountId = input.accountId ?? randomId();
		const [row] = await this.db
			.insert(accountTable)
			.values({
				accountId,
				accountConfigId: input.accountConfigId,
				username: input.username,
				email: input.email,
				authType: input.authType ?? "password",
				passwordHash: input.passwordHash,
				oauthRefreshTokenHash: input.oauthRefreshTokenHash,
				oauthTokenUpdatedAt: input.oauthTokenUpdatedAt,
				imapHost: input.imapHost,
				imapPort: input.imapPort,
				imapTls: input.imapTls,
				imapStartTls: input.imapStartTls,
				smtpEnabled: input.smtpEnabled ?? false,
				smtpHost: input.smtpHost ?? "",
				smtpPort: input.smtpPort ?? 587,
				smtpTls: input.smtpTls ?? false,
				smtpStartTls: input.smtpStartTls ?? false,
				smtpUsername: input.smtpUsername ?? "",
				smtpPasswordHash: input.smtpPasswordHash,
				isActive: input.isActive,
				connectionState: input.connectionState,
				lastConnectedAt: input.lastConnectedAt,
				lastSyncAt: input.lastSyncAt,
				lastError: input.lastError,
				syncPhase: input.syncPhase,
				mailboxCountTotal: input.mailboxCountTotal,
				mailboxCountSynced: input.mailboxCountSynced,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return rowToAccount(row);
	}

	async get(accountId: string): Promise<AccountItem>;
	async get(accountIds: string[]): Promise<AccountItem[]>;
	async get(
		accountId: string | string[],
	): Promise<AccountItem | AccountItem[]> {
		if (Array.isArray(accountId)) {
			if (accountId.length === 0) return [];
			const rows = await this.db
				.select()
				.from(accountTable)
				.where(inArray(accountTable.accountId, accountId));
			return rows.map(rowToAccount);
		}
		const [row] = await this.db
			.select()
			.from(accountTable)
			.where(eq(accountTable.accountId, accountId));
		if (!row) throw new NotFoundError(`Account not found: ${accountId}`);
		return rowToAccount(row);
	}

	async update(
		accountId: string,
		input: UpdateAccountInput,
		remove?: (keyof UpdateAccountInput)[],
	): Promise<AccountItem> {
		const now = Date.now();
		const updates: Partial<typeof accountTable.$inferInsert> = {
			updatedAt: now,
		};

		if (input.username !== undefined) updates.username = input.username;
		if (input.email !== undefined) updates.email = input.email;
		if (input.authType !== undefined) updates.authType = input.authType;
		if (input.passwordHash !== undefined)
			updates.passwordHash = input.passwordHash;
		if (input.oauthRefreshTokenHash !== undefined)
			updates.oauthRefreshTokenHash = input.oauthRefreshTokenHash;
		if (input.oauthTokenUpdatedAt !== undefined)
			updates.oauthTokenUpdatedAt = input.oauthTokenUpdatedAt;
		if (input.imapHost !== undefined) updates.imapHost = input.imapHost;
		if (input.imapPort !== undefined) updates.imapPort = input.imapPort;
		if (input.imapTls !== undefined) updates.imapTls = input.imapTls;
		if (input.imapStartTls !== undefined)
			updates.imapStartTls = input.imapStartTls;
		if (input.smtpEnabled !== undefined)
			updates.smtpEnabled = input.smtpEnabled;
		if (input.smtpHost !== undefined) updates.smtpHost = input.smtpHost;
		if (input.smtpPort !== undefined) updates.smtpPort = input.smtpPort;
		if (input.smtpTls !== undefined) updates.smtpTls = input.smtpTls;
		if (input.smtpStartTls !== undefined)
			updates.smtpStartTls = input.smtpStartTls;
		if (input.smtpUsername !== undefined)
			updates.smtpUsername = input.smtpUsername;
		if (input.isActive !== undefined) updates.isActive = input.isActive;
		if (input.connectionState !== undefined)
			updates.connectionState = input.connectionState;
		if (input.lastConnectedAt !== undefined)
			updates.lastConnectedAt = input.lastConnectedAt;
		if (input.lastSyncAt !== undefined) updates.lastSyncAt = input.lastSyncAt;
		if (input.lastError !== undefined) updates.lastError = input.lastError;
		if (input.syncPhase !== undefined) updates.syncPhase = input.syncPhase;
		if (input.mailboxCountTotal !== undefined)
			updates.mailboxCountTotal = input.mailboxCountTotal;
		if (input.mailboxCountSynced !== undefined)
			updates.mailboxCountSynced = input.mailboxCountSynced;

		// Handle field removal (set to null)
		if (remove) {
			for (const field of remove) {
				if (field === "lastError") updates.lastError = null;
				if (field === "lastConnectedAt") updates.lastConnectedAt = null;
				if (field === "lastSyncAt") updates.lastSyncAt = null;
				if (field === "syncPhase") updates.syncPhase = null;
			}
		}

		const [row] = await this.db
			.update(accountTable)
			.set(updates)
			.where(eq(accountTable.accountId, accountId))
			.returning();
		if (!row) throw new NotFoundError(`Account not found: ${accountId}`);
		return rowToAccount(row);
	}

	async markAuthenticated(accountId: string): Promise<AccountItem> {
		const now = Date.now();
		const [row] = await this.db
			.update(accountTable)
			.set({
				connectionState: "authenticated",
				lastConnectedAt: now,
				lastError: null,
				updatedAt: now,
			})
			.where(eq(accountTable.accountId, accountId))
			.returning();
		if (!row) throw new NotFoundError(`Account not found: ${accountId}`);
		return rowToAccount(row);
	}

	async delete(accountId: string): Promise<void> {
		await this.db
			.delete(accountTable)
			.where(eq(accountTable.accountId, accountId));
	}

	async deleteMany(accountIds: string[]): Promise<void> {
		if (accountIds.length === 0) return;
		await this.db
			.delete(accountTable)
			.where(inArray(accountTable.accountId, accountIds));
	}

	async list(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<AccountItem>> {
		const limit = options?.limit ?? 100;
		const cursor = options?.continuationToken
			? decodeToken(options.continuationToken)
			: undefined;
		const after = cursor
			? {
					createdAt: cursor.createdAt as number,
					accountId: cursor.accountId as string,
				}
			: undefined;

		const rows = await this.db
			.select()
			.from(accountTable)
			.where(
				and(
					eq(accountTable.accountConfigId, accountConfigId),
					after
						? or(
								gt(accountTable.createdAt, after.createdAt),
								and(
									eq(accountTable.createdAt, after.createdAt),
									gt(accountTable.accountId, after.accountId),
								),
							)
						: undefined,
				),
			)
			.orderBy(asc(accountTable.createdAt), asc(accountTable.accountId))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(rowToAccount);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			hasMore && lastItem
				? { createdAt: lastItem.createdAt, accountId: lastItem.accountId }
				: undefined,
		);
	}

	async listAllByAccountConfig(
		accountConfigId: string,
	): Promise<AccountItem[]> {
		const rows = await this.db
			.select()
			.from(accountTable)
			.where(eq(accountTable.accountConfigId, accountConfigId));
		return rows.map(rowToAccount);
	}

	async describe(accountId: string): Promise<AccountDescription> {
		const [accounts, mailboxes] = await Promise.all([
			this.db
				.select()
				.from(accountTable)
				.where(eq(accountTable.accountId, accountId)),
			this.db
				.select()
				.from(mailboxTable)
				.where(eq(mailboxTable.accountId, accountId)),
		]);
		if (accounts.length === 0) {
			throw new NotFoundError(`Account not found: ${accountId}`);
		}
		return {
			account: accounts.map(rowToAccount),
			mailbox: mailboxes.map(rowToMailbox),
		};
	}

	async listAll(): Promise<AccountItem[]> {
		const rows = await this.db.select().from(accountTable);
		return rows.map(rowToAccount);
	}

	async incrementMailboxSynced(accountId: string): Promise<AccountItem> {
		// Atomic increment via UPDATE ... SET x = x + 1 RETURNING
		const [row] = await this.db
			.update(accountTable)
			.set({
				mailboxCountSynced: sql`COALESCE(${accountTable.mailboxCountSynced}, 0) + 1`,
				updatedAt: Date.now(),
			})
			.where(eq(accountTable.accountId, accountId))
			.returning();

		if (!row) throw new NotFoundError(`Account not found: ${accountId}`);
		const updated = rowToAccount(row);

		const total = updated.mailboxCountTotal ?? 0;
		const synced = updated.mailboxCountSynced ?? 0;

		if (total > 0 && synced >= total) {
			const [clamped] = await this.db
				.update(accountTable)
				.set({
					syncPhase: SyncPhase.complete,
					mailboxCountSynced: total,
					updatedAt: Date.now(),
				})
				.where(eq(accountTable.accountId, accountId))
				.returning();
			return clamped ? rowToAccount(clamped) : updated;
		}

		return updated;
	}
}
