import type {
	ILabelMailboxRepository,
	LabelMailboxItem,
	PutLabelMailboxInput,
} from "@remit/data-ports";
import { eq } from "drizzle-orm";
import type { RepositoryDb } from "../db.js";
import { deterministicBase36Id } from "../id.js";
import { labelMailboxTable } from "../schema.js";

const rowToLabelMailbox = (
	row: typeof labelMailboxTable.$inferSelect,
): LabelMailboxItem => ({
	labelMailboxId: row.labelMailboxId,
	labelId: row.labelId,
	accountId: row.accountId,
	mailboxId: row.mailboxId,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

export class LabelMailboxRepo implements ILabelMailboxRepository {
	constructor(private db: RepositoryDb) {}

	static deriveId(labelId: string, accountId: string): string {
		return deterministicBase36Id(`labelMailbox:${labelId}:${accountId}`);
	}

	async put(input: PutLabelMailboxInput): Promise<LabelMailboxItem> {
		const now = Date.now();
		const [row] = await this.db
			.insert(labelMailboxTable)
			.values({
				labelMailboxId: LabelMailboxRepo.deriveId(
					input.labelId,
					input.accountId,
				),
				labelId: input.labelId,
				accountId: input.accountId,
				mailboxId: input.mailboxId,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: labelMailboxTable.labelMailboxId,
				set: { mailboxId: input.mailboxId, updatedAt: now },
			})
			.returning();
		return rowToLabelMailbox(row);
	}

	async get(
		labelId: string,
		accountId: string,
	): Promise<LabelMailboxItem | null> {
		const [row] = await this.db
			.select()
			.from(labelMailboxTable)
			.where(
				eq(
					labelMailboxTable.labelMailboxId,
					LabelMailboxRepo.deriveId(labelId, accountId),
				),
			);
		return row ? rowToLabelMailbox(row) : null;
	}

	async listByAccount(accountId: string): Promise<LabelMailboxItem[]> {
		const rows = await this.db
			.select()
			.from(labelMailboxTable)
			.where(eq(labelMailboxTable.accountId, accountId));
		return rows.map(rowToLabelMailbox);
	}
}
