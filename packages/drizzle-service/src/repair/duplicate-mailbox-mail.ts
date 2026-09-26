import { count, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "../db.js";
import { deleteMessageSubtree } from "../repos/message.js";
import { mailboxTable } from "../schema/i4-mailbox.js";
import { messageTable } from "../schema/message-data.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { messageLabelTable } from "../schema.js";
import { runInTransaction } from "../tx.js";

export const PARKED_MAILBOX_ID = "DuplicateMailboxRemoved";

type DuplicateMailDb = Db<Record<string, unknown>>;

export type DuplicateMailRepairMode = "check" | "repair";

export type DuplicateMailReport = {
	readonly mode: DuplicateMailRepairMode;
	readonly duplicatePaths: number;
	readonly parked: number;
	readonly removed: number;
};

const BATCH_SIZE = 100;

const countDuplicatePaths = async (db: DuplicateMailDb): Promise<number> => {
	const groups = await db
		.select({ rows: count() })
		.from(mailboxTable)
		.groupBy(mailboxTable.accountId, mailboxTable.fullPath)
		.having(gt(count(), 1));
	return groups.length;
};

const countParked = async (db: DuplicateMailDb): Promise<number> => {
	const [row] = await db
		.select({ parked: count() })
		.from(messageTable)
		.where(eq(messageTable.mailboxId, PARKED_MAILBOX_ID));
	return row?.parked ?? 0;
};

const nextParkedBatch = async (db: DuplicateMailDb): Promise<string[]> => {
	const rows = await db
		.select({ messageId: messageTable.messageId })
		.from(messageTable)
		.where(eq(messageTable.mailboxId, PARKED_MAILBOX_ID))
		.limit(BATCH_SIZE);
	return rows.map((row) => row.messageId);
};

export const sweepDuplicateMailboxMail = async (
	db: DuplicateMailDb,
	mode: DuplicateMailRepairMode,
): Promise<DuplicateMailReport> => {
	const duplicatePaths = await countDuplicatePaths(db);
	const parked = await countParked(db);
	if (mode === "check" || parked === 0) {
		return { mode, duplicatePaths, parked, removed: 0 };
	}

	let removed = 0;
	for (;;) {
		const messageIds = await nextParkedBatch(db);
		if (messageIds.length === 0) break;
		await runInTransaction(db, async (tx) => {
			await deleteMessageSubtree(tx, messageIds);
			await tx
				.delete(threadMessageTable)
				.where(inArray(threadMessageTable.messageId, messageIds));
			await tx
				.delete(messageLabelTable)
				.where(inArray(messageLabelTable.messageId, messageIds));
		});
		removed += messageIds.length;
	}
	return { mode, duplicatePaths, parked, removed };
};

export const formatDuplicateMailReport = (
	report: DuplicateMailReport,
): string[] => {
	const lines: string[] = [];
	if (report.duplicatePaths > 0) {
		lines.push(
			`${report.duplicatePaths} folder path(s) held by more than one row, merged by the pending migration`,
		);
	}
	if (report.parked === 0) {
		lines.push("No message is parked by the folder dedupe");
		return lines;
	}
	lines.push(
		report.mode === "check"
			? `${report.parked} message(s) parked by the folder dedupe, would be removed`
			: `${report.removed} of ${report.parked} message(s) parked by the folder dedupe removed`,
	);
	return lines;
};
