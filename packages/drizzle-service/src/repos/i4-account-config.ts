import type {
	AccountConfigDescription,
	AccountConfigItem,
	AccountItem,
	AddressItem,
	CreateAccountConfigInput,
	IAccountConfigRepository,
	ResultList,
	UpdateAccountConfigInput,
} from "@remit/data-ports";
import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { decodeToken, resultList } from "../pagination.js";
import {
	accountConfigTable,
	accountTable,
} from "../schema/i4-account-config.js";
import { addressTable } from "../schema/i4-address.js";

type DB = NodePgDatabase<Record<string, unknown>>;

function rowToAccountConfig(
	row: typeof accountConfigTable.$inferSelect,
): AccountConfigItem {
	return {
		accountConfigId: row.accountConfigId,
		userId: row.userId,
		name: row.name ?? undefined,
		state: row.state as AccountConfigItem["state"],
		deletedAt: row.deletedAt ?? undefined,
		cascadeStartedAt: row.cascadeStartedAt ?? undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function rowToAccount(row: typeof accountTable.$inferSelect): AccountItem {
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
		lastActivityAt: row.lastActivityAt ?? 0,
		lastError: row.lastError ?? undefined,
		syncPhase: (row.syncPhase as AccountItem["syncPhase"]) ?? undefined,
		mailboxCountTotal: row.mailboxCountTotal ?? undefined,
		mailboxCountSynced: row.mailboxCountSynced ?? undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt ?? undefined,
	};
}

function rowToAddress(row: typeof addressTable.$inferSelect): AddressItem {
	return {
		addressId: row.addressId,
		accountConfigId: row.accountConfigId,
		displayName: row.displayName ?? undefined,
		localPart: row.localPart,
		domain: row.domain,
		normalizedEmail: row.normalizedEmail,
		normalizedCompound: row.normalizedCompound,
		flags: (row.flags ?? {}) as AddressItem["flags"],
		inboundCount: row.inboundCount,
		outboundCount: row.outboundCount,
		replyCount: row.replyCount,
		lastInboundAt: row.lastInboundAt,
		lastOutboundAt: row.lastOutboundAt ?? undefined,
		lastReplyAt: row.lastReplyAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class AccountConfigRepo implements IAccountConfigRepository {
	constructor(private db: DB) {}

	async create(input: CreateAccountConfigInput): Promise<AccountConfigItem> {
		const now = Date.now();
		const accountConfigId = input.accountConfigId ?? randomId();
		const [row] = await this.db
			.insert(accountConfigTable)
			.values({
				accountConfigId,
				userId: input.userId,
				name: input.name,
				state: input.state ?? "active",
				deletedAt: input.deletedAt,
				cascadeStartedAt: input.cascadeStartedAt,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return rowToAccountConfig(row);
	}

	async get(accountConfigId: string): Promise<AccountConfigItem>;
	async get(accountConfigIds: string[]): Promise<AccountConfigItem[]>;
	async get(
		accountConfigId: string | string[],
	): Promise<AccountConfigItem | AccountConfigItem[]> {
		if (Array.isArray(accountConfigId)) {
			if (accountConfigId.length === 0) return [];
			const rows = await this.db
				.select()
				.from(accountConfigTable)
				.where(inArray(accountConfigTable.accountConfigId, accountConfigId));
			return rows.map(rowToAccountConfig);
		}
		const [row] = await this.db
			.select()
			.from(accountConfigTable)
			.where(eq(accountConfigTable.accountConfigId, accountConfigId));
		if (!row)
			throw new NotFoundError(`AccountConfig not found: ${accountConfigId}`);
		return rowToAccountConfig(row);
	}

	async update(
		accountConfigId: string,
		input: UpdateAccountConfigInput,
	): Promise<AccountConfigItem> {
		const now = Date.now();
		const [row] = await this.db
			.update(accountConfigTable)
			.set({
				...(input.name !== undefined && { name: input.name }),
				...(input.state !== undefined && { state: input.state }),
				...(input.deletedAt !== undefined && { deletedAt: input.deletedAt }),
				...(input.cascadeStartedAt !== undefined && {
					cascadeStartedAt: input.cascadeStartedAt,
				}),
				updatedAt: now,
			})
			.where(eq(accountConfigTable.accountConfigId, accountConfigId))
			.returning();
		if (!row)
			throw new NotFoundError(`AccountConfig not found: ${accountConfigId}`);
		return rowToAccountConfig(row);
	}

	async delete(accountConfigId: string): Promise<void> {
		await this.db
			.delete(accountConfigTable)
			.where(eq(accountConfigTable.accountConfigId, accountConfigId));
	}

	async deleteMany(accountConfigIds: string[]): Promise<void> {
		if (accountConfigIds.length === 0) return;
		await this.db
			.delete(accountConfigTable)
			.where(inArray(accountConfigTable.accountConfigId, accountConfigIds));
	}

	async listByUser(
		userId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<AccountConfigItem>> {
		const limit = options?.limit ?? 100;
		const cursor = options?.continuationToken
			? decodeToken(options.continuationToken)
			: undefined;
		const after = cursor
			? {
					createdAt: cursor.createdAt as number,
					accountConfigId: cursor.accountConfigId as string,
				}
			: undefined;

		const rows = await this.db
			.select()
			.from(accountConfigTable)
			.where(
				and(
					eq(accountConfigTable.userId, userId),
					after
						? or(
								gt(accountConfigTable.createdAt, after.createdAt),
								and(
									eq(accountConfigTable.createdAt, after.createdAt),
									gt(accountConfigTable.accountConfigId, after.accountConfigId),
								),
							)
						: undefined,
				),
			)
			.orderBy(
				asc(accountConfigTable.createdAt),
				asc(accountConfigTable.accountConfigId),
			)
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(rowToAccountConfig);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			hasMore && lastItem
				? {
						createdAt: lastItem.createdAt,
						accountConfigId: lastItem.accountConfigId,
					}
				: undefined,
		);
	}

	async describe(accountConfigId: string): Promise<AccountConfigDescription> {
		const [configs, accounts, addresses] = await Promise.all([
			this.db
				.select()
				.from(accountConfigTable)
				.where(eq(accountConfigTable.accountConfigId, accountConfigId)),
			this.db
				.select()
				.from(accountTable)
				.where(eq(accountTable.accountConfigId, accountConfigId)),
			this.db
				.select()
				.from(addressTable)
				.where(eq(addressTable.accountConfigId, accountConfigId)),
		]);
		if (configs.length === 0) {
			throw new NotFoundError(`AccountConfig not found: ${accountConfigId}`);
		}
		return {
			accountConfig: configs.map(rowToAccountConfig),
			account: accounts.map(rowToAccount),
			address: addresses.map(rowToAddress),
		};
	}

	async listAll(): Promise<AccountConfigItem[]> {
		const rows = await this.db.select().from(accountConfigTable);
		return rows.map(rowToAccountConfig);
	}
}
