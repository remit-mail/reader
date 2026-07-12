import type {
	CreateLabelInput,
	ILabelRepository,
	LabelItem,
	UpdateLabelInput,
} from "@remit/data-ports";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { labelTable } from "../schema.js";

type DB = NodePgDatabase<Record<string, unknown>>;

const normalize = (name: string): string => name.trim().toLowerCase();

function rowToLabel(row: typeof labelTable.$inferSelect): LabelItem {
	return {
		labelId: row.labelId,
		accountConfigId: row.accountConfigId,
		name: row.name,
		normalizedName: row.normalizedName,
		color: row.color,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class LabelRepo implements ILabelRepository {
	constructor(private db: DB) {}

	async create(input: CreateLabelInput): Promise<LabelItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(labelTable)
			.values({
				labelId: randomId(),
				accountConfigId: input.accountConfigId,
				name: input.name,
				normalizedName: normalize(input.name),
				color: input.color ?? "Default",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return rowToLabel(row);
	}

	async get(accountConfigId: string, labelId: string): Promise<LabelItem> {
		const [row] = await this.db
			.select()
			.from(labelTable)
			.where(
				and(
					eq(labelTable.accountConfigId, accountConfigId),
					eq(labelTable.labelId, labelId),
				),
			);
		if (!row) {
			throw new NotFoundError(`Label not found: ${labelId}`);
		}
		return rowToLabel(row);
	}

	async update(
		accountConfigId: string,
		labelId: string,
		input: UpdateLabelInput,
	): Promise<LabelItem> {
		const patch =
			input.name !== undefined
				? { ...input, normalizedName: normalize(input.name) }
				: input;
		const [row] = await this.db
			.update(labelTable)
			.set({ ...patch, updatedAt: Date.now() })
			.where(
				and(
					eq(labelTable.accountConfigId, accountConfigId),
					eq(labelTable.labelId, labelId),
				),
			)
			.returning();
		if (!row) {
			throw new NotFoundError(`Label not found: ${labelId}`);
		}
		return rowToLabel(row);
	}

	async delete(accountConfigId: string, labelId: string): Promise<void> {
		await this.db
			.delete(labelTable)
			.where(
				and(
					eq(labelTable.accountConfigId, accountConfigId),
					eq(labelTable.labelId, labelId),
				),
			);
	}

	async listByAccountConfig(accountConfigId: string): Promise<LabelItem[]> {
		const rows = await this.db
			.select()
			.from(labelTable)
			.where(eq(labelTable.accountConfigId, accountConfigId))
			.orderBy(labelTable.createdAt);
		return rows.map(rowToLabel);
	}

	async findByNormalizedName(
		accountConfigId: string,
		normalizedName: string,
	): Promise<LabelItem | null> {
		const [row] = await this.db
			.select()
			.from(labelTable)
			.where(
				and(
					eq(labelTable.accountConfigId, accountConfigId),
					eq(labelTable.normalizedName, normalize(normalizedName)),
				),
			);
		return row ? rowToLabel(row) : null;
	}
}
