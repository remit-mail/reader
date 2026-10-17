import { deriveThreadId, wireMessageId } from "@remit/data-ports/id";
import { and, count, eq, like } from "drizzle-orm";
import type { Db } from "../db.js";
import { DrizzleThreadMessageRepository } from "../repos/thread-message.js";
import { threadMessageTable } from "../schema/thread-message.js";
import { runInTransaction } from "../tx.js";

type ThreadRootDb = Db<Record<string, unknown>>;

export type ThreadRootRepairMode = "check" | "repair";

export interface ThreadRootReport {
	readonly mode: ThreadRootRepairMode;
	readonly misfiled: number;
	readonly moved: number;
	readonly dropped: number;
}

interface MisfiledThread {
	readonly accountConfigId: string;
	readonly from: string;
	readonly parent: string;
	readonly rows: number;
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

const misfiledThreads = async (db: ThreadRootDb): Promise<MisfiledThread[]> => {
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

	const threads: MisfiledThread[] = [];
	for (const rekey of rekeys.values()) {
		const [found] = await db
			.select({ rows: count() })
			.from(threadMessageTable)
			.where(
				and(
					eq(threadMessageTable.accountConfigId, rekey.accountConfigId),
					eq(threadMessageTable.threadId, rekey.from),
				),
			);
		const rows = found?.rows ?? 0;
		if (rows > 0) threads.push({ ...rekey, rows });
	}
	return threads;
};

const threadOfParent = async (
	tx: ThreadRootDb,
	thread: MisfiledThread,
): Promise<string> => {
	const [stored] = await tx
		.select({ threadId: threadMessageTable.threadId })
		.from(threadMessageTable)
		.where(
			and(
				eq(threadMessageTable.accountConfigId, thread.accountConfigId),
				eq(threadMessageTable.messageIdHeader, thread.parent),
			),
		)
		.limit(1);
	return (
		stored?.threadId ?? deriveThreadId(thread.accountConfigId, thread.parent)
	);
};

const rowsIn = (threads: readonly MisfiledThread[]): number =>
	threads.reduce((total, thread) => total + thread.rows, 0);

export const moveMisfiledThreadRows = async (
	db: ThreadRootDb,
	mode: ThreadRootRepairMode,
): Promise<ThreadRootReport> => {
	const found = await misfiledThreads(db);
	const misfiled = rowsIn(found);
	if (mode === "check" || misfiled === 0) {
		return { mode, misfiled, moved: 0, dropped: 0 };
	}

	return runInTransaction(db, async (tx) => {
		const threadMessages = new DrizzleThreadMessageRepository(tx);
		let moved = 0;
		let dropped = 0;
		for (let pass = 0; pass < MAX_PASSES; pass += 1) {
			const threads = await misfiledThreads(tx);
			if (threads.length === 0) return { mode, misfiled, moved, dropped };
			for (const thread of threads) {
				const result = await threadMessages.rekeyThread(
					thread.accountConfigId,
					thread.from,
					await threadOfParent(tx, thread),
				);
				moved += result.moved;
				dropped += result.dropped;
			}
		}
		const left = await misfiledThreads(tx);
		if (left.length === 0) return { mode, misfiled, moved, dropped };
		throw new Error(
			`${rowsIn(left)} thread row(s) still filed under a doubled-bracket root after ${MAX_PASSES} passes: ${left.map((thread) => `${thread.from} (parent ${thread.parent})`).join(", ")}`,
		);
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
	];
};
