import type {
	CreateOrganizeJobRequestInput,
	IOrganizeJobRequestRepository,
	OrganizeJobRequestItem,
	ResultList,
	UpdateOrganizeJobRequestInput,
} from "@remit/data-ports";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NotFoundError } from "../error.js";
import { randomId } from "../id.js";
import { decodeToken, resultList } from "../pagination.js";
import { organizeJobRequestTable } from "../schema/i4-organize-job-request.js";

type DB = NodePgDatabase<Record<string, unknown>>;

function rowToItem(
	row: typeof organizeJobRequestTable.$inferSelect,
): OrganizeJobRequestItem {
	return {
		organizeJobId: row.organizeJobId,
		accountConfigId: row.accountConfigId,
		userId: row.userId,
		state: row.state as OrganizeJobRequestItem["state"],
		anchorMessageId: row.anchorMessageId,
		matchOperator: row.matchOperator as OrganizeJobRequestItem["matchOperator"],
		literalClauses:
			row.literalClauses as OrganizeJobRequestItem["literalClauses"],
		similarityThreshold: row.similarityThreshold,
		actionLabelId: row.actionLabelId,
		actionMailboxId: row.actionMailboxId,
		matchedCount: row.matchedCount,
		appliedCount: row.appliedCount,
		failedCount: row.failedCount,
		errorMessage: row.errorMessage,
		ttl: row.ttl,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export class OrganizeJobRequestRepo implements IOrganizeJobRequestRepository {
	constructor(private db: DB) {}

	async create(
		input: CreateOrganizeJobRequestInput,
	): Promise<OrganizeJobRequestItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(organizeJobRequestTable)
			.values({
				organizeJobId: randomId(),
				accountConfigId: input.accountConfigId,
				userId: input.userId,
				state: input.state ?? "Pending",
				anchorMessageId: input.anchorMessageId,
				matchOperator: input.matchOperator,
				literalClauses: input.literalClauses,
				similarityThreshold: input.similarityThreshold,
				actionLabelId: input.actionLabelId,
				actionMailboxId: input.actionMailboxId,
				matchedCount: 0,
				appliedCount: 0,
				failedCount: 0,
				errorMessage: "",
				ttl: input.ttl,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return rowToItem(row);
	}

	async get(organizeJobId: string): Promise<OrganizeJobRequestItem> {
		const [row] = await this.db
			.select()
			.from(organizeJobRequestTable)
			.where(eq(organizeJobRequestTable.organizeJobId, organizeJobId));
		if (!row)
			throw new NotFoundError(`OrganizeJobRequest not found: ${organizeJobId}`);
		return rowToItem(row);
	}

	async update(
		organizeJobId: string,
		input: UpdateOrganizeJobRequestInput,
	): Promise<OrganizeJobRequestItem> {
		const now = Date.now();
		const updates: Partial<typeof organizeJobRequestTable.$inferInsert> = {
			updatedAt: now,
		};
		if (input.state !== undefined) updates.state = input.state;
		if (input.matchedCount !== undefined)
			updates.matchedCount = input.matchedCount;
		if (input.appliedCount !== undefined)
			updates.appliedCount = input.appliedCount;
		if (input.failedCount !== undefined)
			updates.failedCount = input.failedCount;
		if (input.errorMessage !== undefined)
			updates.errorMessage = input.errorMessage;

		const [row] = await this.db
			.update(organizeJobRequestTable)
			.set(updates)
			.where(eq(organizeJobRequestTable.organizeJobId, organizeJobId))
			.returning();
		if (!row)
			throw new NotFoundError(`OrganizeJobRequest not found: ${organizeJobId}`);
		return rowToItem(row);
	}

	async listByAccountConfig(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<OrganizeJobRequestItem>> {
		const limit = options?.limit ?? 100;

		if (options?.continuationToken) {
			decodeToken(options.continuationToken);
		}

		const rows = await this.db
			.select()
			.from(organizeJobRequestTable)
			.where(eq(organizeJobRequestTable.accountConfigId, accountConfigId))
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
						organizeJobId: lastItem.organizeJobId,
					}
				: undefined,
		);
	}
}
