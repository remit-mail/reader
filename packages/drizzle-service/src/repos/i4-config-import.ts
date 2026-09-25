import type {
	ConfigImportItem,
	ConfigImportUnresolvedRefItem,
	CreateConfigImportInput,
	IConfigImportRepository,
	UpdateConfigImportInput,
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

// A row written before the binder created folders carries refs without a
// mailboxId; they read as refs no create has been issued for.
const refsOf = (value: unknown): ConfigImportUnresolvedRefItem[] =>
	(value as StoredRef[]).map((ref) => ({
		...ref,
		mailboxId: ref.mailboxId ?? "None",
	}));

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
