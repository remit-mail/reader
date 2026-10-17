/**
 * The repair for threads keyed on a misspelt root Message-ID.
 *
 * Reader's replies went out as `In-Reply-To: <<id>>` and `References: <<id>>`:
 * the composer passed the parent's id with its brackets and the builder wrapped
 * it again. Sync keyed the thread on the header as written, so every such reply
 * opened a thread of its own beside the conversation it answered, and a
 * correspondent whose client copied the References joined that split thread
 * too. Sync now keys on the wire spelling, `<id>`, which mends what it saves
 * next and nothing already saved: those rows sit under the old key, and a
 * re-sync on top of them adds a second row rather than moving the first.
 *
 * So the old keys are re-derived here, once, at boot. Every stored header whose
 * spelling is not the wire one names two keys a thread may have been filed
 * under — the spelling itself and its doubled form — and any row under either
 * moves to the key sync derives now. The row id is derived from the thread, so
 * it moves with it; where sync already wrote the row under the new key, the
 * stale one is dropped instead.
 *
 * The semantic index stores each message's thread id beside its vectors, so
 * every message whose row moved is queued for the forced re-index a folder move
 * gets: a `message.moved` outbox row, which the search-index worker answers by
 * reading the thread row again. The row is queued before the move, so a crash
 * between the two leaves the move for the next boot rather than an index entry
 * nothing will refresh.
 *
 * Message identity is untouched: a message row is keyed on its own Message-ID
 * as the server returns it, and that is not what was misspelt.
 */

import { randomUUID } from "node:crypto";
import { deriveThreadId } from "@remit/data-ports/id";
import { bareMessageId, wireMessageId } from "@remit/data-ports/message-id";
import { deriveThreadMessageId } from "../repos/thread-message.js";

export interface ThreadRootRepairClient {
	all(sql: string, params: readonly unknown[]): Promise<unknown[]>;
	run(sql: string, params: readonly unknown[]): Promise<number>;
}

export type ThreadRootRepairMode = "check" | "repair";

export interface ThreadRootReport {
	readonly mode: ThreadRootRepairMode;
	/** Rows filed under a key sync no longer derives. */
	readonly misfiled: number;
	readonly moved: number;
	/** Misfiled rows sync had already written again under the right key. */
	readonly dropped: number;
	/** Moved messages newly queued for re-indexing. */
	readonly reindexed: number;
	/** Distinct misspelt `in_reply_to` values, and how many rows were rewritten. */
	readonly misspeltInReplyTo: number;
	readonly rewritten: number;
}

const MISSPELT = `(spelling LIKE '<<%' OR spelling LIKE '%>>'
	OR spelling NOT LIKE '<%>' OR spelling <> trim(spelling))`;

const SPELLINGS_SQL = `SELECT DISTINCT account_config_id, spelling, is_in_reply_to FROM (
	SELECT account_config_id, in_reply_to AS spelling, 1 AS is_in_reply_to
	FROM thread_message
	UNION
	SELECT account_config_id, message_id_header AS spelling, 0 AS is_in_reply_to
	FROM thread_message
)
WHERE spelling IS NOT NULL AND spelling <> '' AND ${MISSPELT}`;

const ROWS_SQL = `SELECT thread_message_id, message_id FROM thread_message
WHERE account_config_id = ? AND thread_id = ?`;

const EXISTS_SQL = "SELECT 1 FROM thread_message WHERE thread_message_id = ?";

const DROP_SQL = "DELETE FROM thread_message WHERE thread_message_id = ?";

const MOVE_SQL = `UPDATE thread_message SET thread_id = ?, thread_message_id = ?
WHERE thread_message_id = ?`;

const REINDEX_SQL = `INSERT INTO outbox (id, message_id, event, payload, created_at)
SELECT ?, ?, 'message.moved', ?, ?
WHERE NOT EXISTS (
	SELECT 1 FROM outbox
	WHERE message_id = ? AND event = 'message.moved' AND processed_at IS NULL
)`;

const IN_REPLY_TO_SQL = `UPDATE thread_message SET in_reply_to = ?
WHERE account_config_id = ? AND in_reply_to = ?`;

interface Rekey {
	readonly accountConfigId: string;
	readonly from: string;
	readonly to: string;
}

const rekeysFor = (accountConfigId: string, spelling: string): Rekey[] => {
	const bare = bareMessageId(spelling);
	if (bare === "") return [];
	const wire = wireMessageId(bare).toLowerCase();
	const to = deriveThreadId(accountConfigId, wire);
	return [...new Set([spelling.toLowerCase(), `<<${bare.toLowerCase()}>>`])]
		.filter((key) => key !== wire)
		.map((key) => ({
			accountConfigId,
			from: deriveThreadId(accountConfigId, key),
			to,
		}));
};

interface MisfiledRow {
	readonly threadMessageId: string;
	readonly messageId: string;
	readonly to: string;
}

const misfiledRows = async (
	client: ThreadRootRepairClient,
	rekeys: readonly Rekey[],
): Promise<MisfiledRow[]> => {
	const rows: MisfiledRow[] = [];
	for (const rekey of rekeys) {
		const found = (await client.all(ROWS_SQL, [
			rekey.accountConfigId,
			rekey.from,
		])) as { thread_message_id: string; message_id: string }[];
		for (const row of found) {
			rows.push({
				threadMessageId: row.thread_message_id,
				messageId: row.message_id,
				to: rekey.to,
			});
		}
	}
	return rows;
};

/**
 * Rows move before any `in_reply_to` is rewritten. The misspelt values are what
 * name the old keys, so rewriting them first and crashing would leave rows
 * under a key no later boot can find.
 */
export const sweepThreadRootSpelling = async (
	client: ThreadRootRepairClient,
	mode: ThreadRootRepairMode,
): Promise<ThreadRootReport> => {
	const spellings = (await client.all(SPELLINGS_SQL, [])) as {
		account_config_id: string;
		spelling: string;
		is_in_reply_to: number;
	}[];
	const rekeys = [
		...new Map(
			spellings
				.flatMap((row) => rekeysFor(row.account_config_id, row.spelling))
				.map((rekey) => [`${rekey.accountConfigId}:${rekey.from}`, rekey]),
		).values(),
	];
	const rows = await misfiledRows(client, rekeys);
	const inReplyTo = spellings.filter(
		(row) => row.is_in_reply_to === 1 && bareMessageId(row.spelling) !== "",
	);
	const found = {
		mode,
		misfiled: rows.length,
		misspeltInReplyTo: inReplyTo.length,
	} as const;

	if (mode === "check") {
		return { ...found, moved: 0, dropped: 0, reindexed: 0, rewritten: 0 };
	}

	let moved = 0;
	let dropped = 0;
	let reindexed = 0;
	for (const row of rows) {
		reindexed += await client.run(REINDEX_SQL, [
			randomUUID(),
			row.messageId,
			JSON.stringify({ messageId: row.messageId }),
			Date.now(),
			row.messageId,
		]);
		const target = deriveThreadMessageId(row.to, row.messageId);
		const existing = await client.all(EXISTS_SQL, [target]);
		if (existing.length > 0) {
			dropped += await client.run(DROP_SQL, [row.threadMessageId]);
			continue;
		}
		moved += await client.run(MOVE_SQL, [row.to, target, row.threadMessageId]);
	}

	let rewritten = 0;
	for (const row of inReplyTo) {
		rewritten += await client.run(IN_REPLY_TO_SQL, [
			wireMessageId(row.spelling),
			row.account_config_id,
			row.spelling,
		]);
	}

	return { ...found, moved, dropped, reindexed, rewritten };
};

export const formatThreadRootReport = (report: ThreadRootReport): string[] => {
	if (report.misfiled === 0 && report.misspeltInReplyTo === 0) {
		return ["No thread is keyed on a misspelt Message-ID"];
	}
	if (report.mode === "check") {
		return [
			`${report.misfiled} message(s) filed under a misspelt thread root would move to the thread they answer`,
			`${report.misspeltInReplyTo} misspelt In-Reply-To value(s) would be respelt`,
		];
	}
	return [
		`${report.moved} of ${report.misfiled} message(s) moved to the thread they answer`,
		`${report.dropped} of ${report.misfiled} stale duplicate(s) dropped`,
		`${report.reindexed} moved message(s) queued for re-indexing`,
		`${report.rewritten} row(s) of In-Reply-To respelt`,
	];
};
