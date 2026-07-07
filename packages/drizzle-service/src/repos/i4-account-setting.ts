import { createHash } from "node:crypto";
import type {
	AccountSettingItem,
	AccountSettingValue,
	IAccountSettingRepository,
	UpsertAccountSettingInput,
} from "@remit/data-ports";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { accountSettingTable } from "../schema/i4-account-setting.js";

type DB = NodePgDatabase<Record<string, unknown>>;

// The PG store derives its own deterministic id from the composite key. It is
// stable within this backend but not byte-identical to the DDB base36 UUIDv5
// id — the two stores key the same row differently by design.
function deriveId(accountConfigId: string, name: string): string {
	return createHash("sha256")
		.update(`accountSetting:${accountConfigId}:${name}`)
		.digest("hex");
}

function rowToAccountSetting(
	row: typeof accountSettingTable.$inferSelect,
): AccountSettingItem {
	return {
		accountSettingId: row.accountSettingId,
		accountConfigId: row.accountConfigId,
		name: row.name,
		value: row.value as AccountSettingValue,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class AccountSettingRepo implements IAccountSettingRepository {
	constructor(private db: DB) {}

	async get(
		accountConfigId: string,
		name: string,
	): Promise<AccountSettingItem | null> {
		const accountSettingId = deriveId(accountConfigId, name);
		const [row] = await this.db
			.select()
			.from(accountSettingTable)
			.where(eq(accountSettingTable.accountSettingId, accountSettingId));
		return row ? rowToAccountSetting(row) : null;
	}

	async listByAccountConfig(
		accountConfigId: string,
	): Promise<AccountSettingItem[]> {
		const rows = await this.db
			.select()
			.from(accountSettingTable)
			.where(eq(accountSettingTable.accountConfigId, accountConfigId))
			.orderBy(accountSettingTable.name);
		return rows.map(rowToAccountSetting);
	}

	async upsert(input: UpsertAccountSettingInput): Promise<AccountSettingItem> {
		const now = Date.now();
		const accountSettingId = deriveId(input.accountConfigId, input.name);
		const [row] = await this.db
			.insert(accountSettingTable)
			.values({
				accountSettingId,
				accountConfigId: input.accountConfigId,
				name: input.name,
				value: input.value as never,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: accountSettingTable.accountSettingId,
				set: {
					value: input.value as never,
					updatedAt: now,
				},
			})
			.returning();
		return rowToAccountSetting(row);
	}

	async delete(accountConfigId: string, name: string): Promise<void> {
		const accountSettingId = deriveId(accountConfigId, name);
		await this.db
			.delete(accountSettingTable)
			.where(eq(accountSettingTable.accountSettingId, accountSettingId));
	}
}
