import {
	type ConfigImportItem,
	type ConfigImportUnresolvedRefItem,
	type CreateConfigImportInput,
	FILTER_NO_ACTION,
	type IConfigImportRepository,
	type UpdateConfigImportInput,
} from "@remit/data-ports";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { configImportTable } from "../schema/i4-config-import.js";

type DB = Db<Record<string, unknown>>;

type StoredRef = Omit<ConfigImportUnresolvedRefItem, "mailboxId"> & {
	mailboxId?: string;
};

const isStoredRef = (value: unknown): value is StoredRef =>
	typeof value === "object" &&
	value !== null &&
	"kind" in value &&
	"accountId" in value &&
	"folderPath" in value &&
	"target" in value;

const refsOf = (value: unknown): ConfigImportUnresolvedRefItem[] => {
	if (!Array.isArray(value) || !value.every(isStoredRef)) {
		throw new Error(
			"config_import.unresolved_refs is not a list of folder references",
		);
	}
	return value.map((ref) => ({
		...ref,
		mailboxId: ref.mailboxId ?? FILTER_NO_ACTION,
	}));
};

function rowToConfigImport(
	row: typeof configImportTable.$inferSelect,
): ConfigImportItem {
	return {
		importId: row.importId,
		accountConfigId: row.accountConfigId,
		schemaVersion: row.schemaVersion,
		state: row.state as ConfigImportItem["state"],
		document: row.document as ConfigImportItem["document"],
		unresolvedRefs: refsOf(row.unresolvedRefs),
		createdAt: row.createdAt,
		completedAt: row.completedAt,
		updatedAt: row.updatedAt,
	};
}

export class ConfigImportRepo implements IConfigImportRepository {
	constructor(private db: DB) {}

	async create(input: CreateConfigImportInput): Promise<ConfigImportItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(configImportTable)
			.values({
				importId: randomId(),
				accountConfigId: input.accountConfigId,
				schemaVersion: input.schemaVersion,
				state: input.state ?? "Pending",
				document: input.document as never,
				unresolvedRefs: input.unresolvedRefs as never,
				createdAt: now,
				completedAt: input.completedAt ?? 0,
				updatedAt: now,
			})
			.returning();
		return rowToConfigImport(row);
	}

	async get(importId: string): Promise<ConfigImportItem> {
		const [row] = await this.db
			.select()
			.from(configImportTable)
			.where(eq(configImportTable.importId, importId));
		if (!row) throw new NotFoundError(`ConfigImport not found: ${importId}`);
		return rowToConfigImport(row);
	}

	async update(
		importId: string,
		input: UpdateConfigImportInput,
	): Promise<ConfigImportItem> {
		const updates: Partial<typeof configImportTable.$inferInsert> = {
			updatedAt: Date.now(),
		};
		if (input.state !== undefined) updates.state = input.state;
		if (input.unresolvedRefs !== undefined)
			updates.unresolvedRefs = input.unresolvedRefs as never;
		if (input.completedAt !== undefined)
			updates.completedAt = input.completedAt;

		const [row] = await this.db
			.update(configImportTable)
			.set(updates)
			.where(eq(configImportTable.importId, importId))
			.returning();
		if (!row) throw new NotFoundError(`ConfigImport not found: ${importId}`);
		return rowToConfigImport(row);
	}

	async listByAccountConfig(
		accountConfigId: string,
	): Promise<ConfigImportItem[]> {
		const rows = await this.db
			.select()
			.from(configImportTable)
			.where(eq(configImportTable.accountConfigId, accountConfigId))
			.orderBy(desc(configImportTable.createdAt));
		return rows.map(rowToConfigImport);
	}
}
