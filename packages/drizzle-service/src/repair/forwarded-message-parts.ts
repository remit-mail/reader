import { asc, eq, inArray } from "drizzle-orm";
import { runBatch, type SqliteBatchItem } from "../batch.js";
import type { Db } from "../db.js";
import {
	bodyPartParameterTable,
	bodyPartStorageTable,
	bodyPartTable,
	bodyStructureRefetchTable,
	messageTable,
} from "../schema/message-data.js";

/**
 * The repair for messages whose forwarded message lost its own part row.
 *
 * imapflow numbers the root of a message/rfc822 part's forwarded message with
 * the part's own number, and the MIME walker used to store both under that one
 * path. The root's row was written last, so it replaced the message/rfc822 row:
 * the forwarded message vanished from the list, and what took its place names
 * itself as its own parent. That self-parented row is the signature, and no
 * other shape produces it.
 *
 * The lost row cannot be rebuilt from what is stored; only the BODYSTRUCTURE
 * the mail server returns has it. So the repair drops the message's part rows
 * — part upserts never overwrite an existing row — and queues the message in
 * `body_structure_refetch`. Message sync drains that queue, reading each
 * queued message's structure again once, and stores its parts.
 *
 * No message, envelope, flag, placement or sync cursor is touched, and the body
 * stays where it is stored.
 */

type ForwardedPartsDb = Db<Record<string, unknown>>;

export type ForwardedPartsRepairMode = "check" | "repair";

export type ForwardedPartsReport = {
	readonly mode: ForwardedPartsRepairMode;
	readonly messages: number;
	readonly partsDropped: number;
};

/** Well under SQLite's bound-parameter limit. */
const CHUNK = 500;

const chunks = (ids: readonly string[]): string[][] => {
	const out: string[][] = [];
	for (let i = 0; i < ids.length; i += CHUNK) {
		out.push(ids.slice(i, i + CHUNK));
	}
	return out;
};

const affectedMessageIds = async (db: ForwardedPartsDb): Promise<string[]> => {
	const rows = await db
		.selectDistinct({ messageId: bodyPartTable.messageId })
		.from(bodyPartTable)
		.where(eq(bodyPartTable.parentBodyPartId, bodyPartTable.bodyPartId))
		.orderBy(asc(bodyPartTable.messageId));
	return rows.map((row) => row.messageId);
};

const storedMessageIds = async (
	db: ForwardedPartsDb,
	ids: string[],
): Promise<string[]> => {
	const rows = await db
		.select({ messageId: messageTable.messageId })
		.from(messageTable)
		.where(inArray(messageTable.messageId, ids));
	return rows.map((row) => row.messageId);
};

/**
 * One batch, so a message never keeps half of its part rows and is never left
 * without parts and off the queue. The rows that hang off a part go before the
 * part rows themselves. A rerun finds only what a failed run left behind.
 */
export const sweepForwardedMessageParts = async (
	db: ForwardedPartsDb,
	mode: ForwardedPartsRepairMode,
): Promise<ForwardedPartsReport> => {
	const messageIds = await affectedMessageIds(db);

	if (mode === "check" || messageIds.length === 0) {
		return { mode, messages: messageIds.length, partsDropped: 0 };
	}

	const now = Date.now();
	const items: SqliteBatchItem[] = [];
	const partDeletes = new Set<number>();
	for (const ids of chunks(messageIds)) {
		const queued = await storedMessageIds(db, ids);
		if (queued.length > 0) {
			items.push(
				db
					.insert(bodyStructureRefetchTable)
					.values(
						queued.map((messageId) => ({
							messageId,
							createdAt: now,
							updatedAt: now,
						})),
					)
					.onConflictDoNothing(),
			);
		}
		items.push(
			db
				.delete(bodyPartParameterTable)
				.where(inArray(bodyPartParameterTable.messageId, ids)),
			db
				.delete(bodyPartStorageTable)
				.where(inArray(bodyPartStorageTable.messageId, ids)),
		);
		partDeletes.add(items.length);
		items.push(
			db
				.delete(bodyPartTable)
				.where(inArray(bodyPartTable.messageId, ids))
				.returning({ bodyPartId: bodyPartTable.bodyPartId }),
		);
	}

	const results = await runBatch(db, items);
	const partsDropped = results.reduce<number>(
		(total, result, index) =>
			partDeletes.has(index) && Array.isArray(result)
				? total + result.length
				: total,
		0,
	);

	return { mode, messages: messageIds.length, partsDropped };
};

export const formatForwardedPartsReport = (
	report: ForwardedPartsReport,
): string[] => {
	if (report.messages === 0) {
		return ["No forwarded message has lost its part row"];
	}
	if (report.mode === "check") {
		return [
			`${report.messages} message(s) lost their forwarded message's part row; their parts would be dropped and queued for message sync to read again`,
		];
	}
	return [
		`${report.partsDropped} part row(s) of ${report.messages} message(s) dropped; message sync reads them again`,
	];
};
