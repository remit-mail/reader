import { deriveThreadId, wireMessageId } from "@remit/data-ports/id";
import { and, eq, like } from "drizzle-orm";
import type { Db } from "../db.js";
import { DrizzleMessageRepository } from "../repos/message.js";
import { deriveThreadMessageId } from "../repos/thread-message.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { runInTransaction } from "../tx.js";

type ThreadRootDb = Db<Record<string, unknown>>;

export type ThreadRootRepairMode = "check" | "repair";

export interface ThreadRootReport {
	readonly mode: ThreadRootRepairMode;
	readonly misfiled: number;
	readonly moved: number;
	readonly dropped: number;
	readonly reindexed: number;
}

interface MisfiledRow {
	readonly threadMessageId: string;
	readonly messageId: string;
	readonly accountConfigId: string;
	readonly parent: string;
}

const DOUBLED = "<<%";

const MAX_PASSES = 8;

const doubledSpellings = async (
	db: ThreadRootDb,
): Promise<{ accountConfigId: string; spelling: string }[]> => {
	const inReplyTo = await db
		.selectDistinct({
			accountConfigId: threadMessageTable.accountConfigId,
			spelling: threadMessageTable.inReplyTo,
		})
		.from(threadMessageTable)
		.where(like(threadMessageTable.inReplyTo, DOUBLED));
	const messageIdHeader = await db
		.selectDistinct({
			accountConfigId: threadMessageTable.accountConfigId,
			spelling: threadMessageTable.messageIdHeader,
		})
		.from(threadMessageTable)
		.where(like(threadMessageTable.messageIdHeader, DOUBLED));
	return [...inReplyTo, ...messageIdHeader].flatMap(
		({ accountConfigId, spelling }) =>
			spelling === null ? [] : [{ accountConfigId, spelling }],
	);
};

const misfiledRows = async (db: ThreadRootDb): Promise<MisfiledRow[]> => {
	const rekeys = new Map<
		string,
		{ accountConfigId: string; from: string; parent: string }
	>();
	for (const { accountConfigId, spelling } of await doubledSpellings(db)) {
		const from = deriveThreadId(accountConfigId, spelling);
		rekeys.set(`${accountConfigId}:${from}`, {
			accountConfigId,
			from,
			parent: wireMessageId(spelling),
		});
	}

	const rows: MisfiledRow[] = [];
	for (const { accountConfigId, from, parent } of rekeys.values()) {
		const found = await db
			.select({
				threadMessageId: threadMessageTable.threadMessageId,
				messageId: threadMessageTable.messageId,
			})
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, accountConfigId),
					eq(threadMessageTable.threadId, from),
				),
			);
		rows.push(...found.map((row) => ({ ...row, accountConfigId, parent })));
	}
	return rows;
};

const threadOfParent = async (
	tx: ThreadRootDb,
	row: MisfiledRow,
): Promise<string> => {
	const [stored] = await tx
		.select({ threadId: threadMessageTable.threadId })
		.from(threadMessageTable)
		.where(
			and(
				eq(threadMessageTable.accountConfigId, row.accountConfigId),
				eq(threadMessageTable.messageIdHeader, row.parent),
			),
		)
		.limit(1);
	return stored?.threadId ?? deriveThreadId(row.accountConfigId, row.parent);
};

const moveRow = async (
	tx: ThreadRootDb,
	row: MisfiledRow,
): Promise<"moved" | "dropped"> => {
	const to = await threadOfParent(tx, row);
	const target = deriveThreadMessageId(to, row.messageId);
	const [existing] = await tx
		.select({ threadMessageId: threadMessageTable.threadMessageId })
		.from(threadMessageTable)
		.where(eq(threadMessageTable.threadMessageId, target));
	if (existing) {
		await tx
			.delete(threadMessageTable)
			.where(eq(threadMessageTable.threadMessageId, row.threadMessageId));
		return "dropped";
	}
	await tx
		.update(threadMessageTable)
		.set({ threadId: to, threadMessageId: target })
		.where(eq(threadMessageTable.threadMessageId, row.threadMessageId));
	return "moved";
};

export const moveMisfiledThreadRows = async (
	db: ThreadRootDb,
	mode: ThreadRootRepairMode,
): Promise<ThreadRootReport> => {
	const found = await misfiledRows(db);
	if (mode === "check" || found.length === 0) {
		return { mode, misfiled: found.length, moved: 0, dropped: 0, reindexed: 0 };
	}

	return runInTransaction(db, async (tx) => {
		const touched = new Set<string>();
		let moved = 0;
		let dropped = 0;
		for (let pass = 0; pass < MAX_PASSES; pass += 1) {
			const rows = await misfiledRows(tx);
			if (rows.length === 0) break;
			for (const row of rows) {
				touched.add(row.messageId);
				if ((await moveRow(tx, row)) === "moved") moved += 1;
				else dropped += 1;
			}
		}
		const { queued } = await new DrizzleMessageRepository(
			tx as unknown as ConstructorParameters<
				typeof DrizzleMessageRepository
			>[0],
		).requestReembed([...touched]);
		return {
			mode,
			misfiled: found.length,
			moved,
			dropped,
			reindexed: queued,
		};
	});
};

export const formatThreadRootReport = (report: ThreadRootReport): string[] => {
	if (report.misfiled === 0) {
		return ["No thread is keyed on a doubled-bracket Message-ID"];
	}
	if (report.mode === "check") {
		return [
			`${report.misfiled} message(s) filed under a doubled-bracket thread root would move to the thread they answer`,
		];
	}
	return [
		`${report.moved} of ${report.misfiled} message(s) moved to the thread they answer`,
		`${report.dropped} of ${report.misfiled} stale duplicate(s) dropped`,
		`${report.reindexed} moved message(s) queued for re-indexing`,
	];
};
