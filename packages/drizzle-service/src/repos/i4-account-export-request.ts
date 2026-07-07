import type {
	AccountExportRequestItem,
	CreateAccountExportRequestInput,
	IAccountExportRequestRepository,
	ResultList,
	UpdateAccountExportRequestInput,
} from "@remit/data-ports";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { decodeToken, resultList } from "../pagination.js";
import { accountExportRequestTable } from "../schema/i4-account-export-request.js";

type DB = NodePgDatabase<Record<string, unknown>>;

function rowToItem(
	row: typeof accountExportRequestTable.$inferSelect,
): AccountExportRequestItem {
	return {
		accountExportRequestId: row.accountExportRequestId,
		accountConfigId: row.accountConfigId,
		userId: row.userId,
		state: row.state as AccountExportRequestItem["state"],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		expiresAt: row.expiresAt ?? undefined,
		objectKey: row.objectKey ?? undefined,
		downloadUrl: row.downloadUrl ?? undefined,
		errorMessage: row.errorMessage ?? undefined,
	};
}

export class AccountExportRequestRepo
	implements IAccountExportRequestRepository
{
	constructor(private db: DB) {}

	async create(
		input: CreateAccountExportRequestInput,
	): Promise<AccountExportRequestItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(accountExportRequestTable)
			.values({
				accountExportRequestId: randomId(),
				accountConfigId: input.accountConfigId,
				userId: input.userId,
				state: input.state ?? "Pending",
				expiresAt: input.expiresAt,
				objectKey: input.objectKey,
				downloadUrl: input.downloadUrl,
				errorMessage: input.errorMessage,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return rowToItem(row);
	}

	async get(accountExportRequestId: string): Promise<AccountExportRequestItem> {
		const [row] = await this.db
			.select()
			.from(accountExportRequestTable)
			.where(
				eq(
					accountExportRequestTable.accountExportRequestId,
					accountExportRequestId,
				),
			);
		if (!row)
			throw new NotFoundError(
				`AccountExportRequest not found: ${accountExportRequestId}`,
			);
		return rowToItem(row);
	}

	async update(
		accountExportRequestId: string,
		input: UpdateAccountExportRequestInput,
	): Promise<AccountExportRequestItem> {
		const now = Date.now();
		const updates: Partial<typeof accountExportRequestTable.$inferInsert> = {
			updatedAt: now,
		};
		if (input.state !== undefined) updates.state = input.state;
		if (input.expiresAt !== undefined) updates.expiresAt = input.expiresAt;
		if (input.errorMessage !== undefined)
			updates.errorMessage = input.errorMessage;
		if (input.objectKey !== undefined) updates.objectKey = input.objectKey;

		const [row] = await this.db
			.update(accountExportRequestTable)
			.set(updates)
			.where(
				eq(
					accountExportRequestTable.accountExportRequestId,
					accountExportRequestId,
				),
			)
			.returning();
		if (!row)
			throw new NotFoundError(
				`AccountExportRequest not found: ${accountExportRequestId}`,
			);
		return rowToItem(row);
	}

	async listByAccountConfig(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<AccountExportRequestItem>> {
		const limit = options?.limit ?? 100;
		let _afterCreatedAt: number | undefined;

		if (options?.continuationToken) {
			const decoded = decodeToken(options.continuationToken);
			_afterCreatedAt = decoded?.createdAt as number | undefined;
		}

		const rows = await this.db
			.select()
			.from(accountExportRequestTable)
			.where(eq(accountExportRequestTable.accountConfigId, accountConfigId))
			.limit(limit + 1);

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(rowToItem);
		const lastItem = items[items.length - 1];
		return resultList(
			items,
			limit,
			hasMore && lastItem
				? {
						createdAt: lastItem.createdAt,
						accountExportRequestId: lastItem.accountExportRequestId,
					}
				: undefined,
		);
	}
}
