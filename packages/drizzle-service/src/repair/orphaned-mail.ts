import { count, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db.js";
import { deleteMessageSubtree } from "../repos/message.js";
import { mailboxTable } from "../schema/i4-mailbox.js";
import { messageTable } from "../schema/message-data.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { runInTransaction } from "../tx.js";

type OrphanedMailDb = Db<Record<string, unknown>>;

export type OrphanedMailRepairMode = "check" | "repair";

export type OrphanedMailReport = {
	readonly mode: OrphanedMailRepairMode;
	readonly orphaned: number;
	readonly removed: number;
};

const BATCH_SIZE = 100;

const countOrphaned = async (db: OrphanedMailDb): Promise<number> => {
	const [row] = await db
		.select({ orphaned: count() })
		.from(messageTable)
		.leftJoin(mailboxTable, eq(mailboxTable.mailboxId, messageTable.mailboxId))
		.where(isNull(mailboxTable.mailboxId));
	return row?.orphaned ?? 0;
};

const nextOrphanedBatch = async (db: OrphanedMailDb): Promise<string[]> => {
	const rows = await db
		.select({ messageId: messageTable.messageId })
		.from(messageTable)
		.leftJoin(mailboxTable, eq(mailboxTable.mailboxId, messageTable.mailboxId))
		.where(isNull(mailboxTable.mailboxId))
		.limit(BATCH_SIZE);
	return rows.map((row) => row.messageId);
};

export const sweepOrphanedMail = async (
	db: OrphanedMailDb,
	mode: OrphanedMailRepairMode,
): Promise<OrphanedMailReport> => {
	const orphaned = await countOrphaned(db);
	if (mode === "check" || orphaned === 0) {
		return { mode, orphaned, removed: 0 };
	}

	let removed = 0;
	for (;;) {
		const messageIds = await nextOrphanedBatch(db);
		if (messageIds.length === 0) break;
		await runInTransaction(db, async (tx) => {
			await deleteMessageSubtree(tx, messageIds);
			await tx
				.delete(threadMessageTable)
				.where(inArray(threadMessageTable.messageId, messageIds));
		});
		removed += messageIds.length;
	}
	return { mode, orphaned, removed };
};

export const formatOrphanedMailReport = (
	report: OrphanedMailReport,
): string[] => {
	if (report.orphaned === 0) {
		return ["No message is left without its folder"];
	}
	if (report.mode === "check") {
		return [
			`${report.orphaned} message(s) left without their folder, would be removed`,
		];
	}
	return [
		`${report.removed} of ${report.orphaned} message(s) left without their folder removed`,
	];
};
