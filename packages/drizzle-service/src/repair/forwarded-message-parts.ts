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
 * the mail server returns has it. So the repair hands the message back to the
 * one path that writes body part rows, message sync: it drops the message's
 * part rows (part upserts never overwrite an existing row), and moves its
 * folder's backfill cursor back above the message so the next sync round
 * fetches it again and the fixed walker stores the parts afresh. The
 * mod-sequence watermark is cleared with it, because a folder holding one takes
 * the CHANGEDSINCE path and never reaches the backfill; sync re-seeds it once
 * the backfill completes. The backfill refetches the folder's headers below
 * that message as well — the cost of the only path that reads BODYSTRUCTURE.
 *
 * No message, envelope, flag or placement is touched, and the body stays where
 * it is stored: body sync skips a message that already has one.
 */

/**
 * The smallest surface this needs, so the module imports no schema and no
 * driver and can be driven by the migrator's `better-sqlite3` handle or a test.
 */
export interface ForwardedPartsRepairClient {
	all(sql: string, params: unknown[]): Promise<unknown[]>;
	run(sql: string, params: unknown[]): Promise<number>;
}

export type ForwardedPartsRepairMode = "check" | "repair";

export type ForwardedPartsReport = {
	readonly mode: ForwardedPartsRepairMode;
	readonly messages: number;
	readonly mailboxes: number;
	readonly partsDropped: number;
	readonly mailboxesRewound: number;
};

const AFFECTED = `SELECT message_id FROM body_part
WHERE parent_body_part_id = body_part_id`;

const AFFECTED_BY_MAILBOX_SQL = `SELECT mailbox_id, max(uid) AS max_uid, count(*) AS messages
FROM message
WHERE message_id IN (${AFFECTED})
GROUP BY mailbox_id
ORDER BY mailbox_id`;

const DROP_DEPENDENT_SQL = [
	`DELETE FROM body_part_parameter WHERE message_id IN (${AFFECTED})`,
	`DELETE FROM body_part_content WHERE message_id IN (${AFFECTED})`,
	`DELETE FROM body_part_storage WHERE message_id IN (${AFFECTED})`,
];

const DROP_PARTS_SQL = `DELETE FROM body_part WHERE message_id IN (${AFFECTED})`;

const REWIND_SQL = `UPDATE mailbox
SET last_sync_uid = max(last_sync_uid, ?), highest_modseq = ''
WHERE mailbox_id = ?`;

interface AffectedMailbox {
	mailbox_id: string;
	max_uid: number;
	messages: number;
}

/**
 * One transaction: a crash between dropping the rows and rewinding the cursor
 * would leave a message with no parts and nothing coming to restore them. The
 * part rows that name the affected messages go last, because they are what
 * names them.
 */
export const sweepForwardedMessageParts = async (
	client: ForwardedPartsRepairClient,
	mode: ForwardedPartsRepairMode,
): Promise<ForwardedPartsReport> => {
	const affected = (await client.all(
		AFFECTED_BY_MAILBOX_SQL,
		[],
	)) as AffectedMailbox[];
	const messages = affected.reduce((sum, row) => sum + row.messages, 0);
	const found = { mode, messages, mailboxes: affected.length } as const;

	if (mode === "check" || messages === 0) {
		return { ...found, partsDropped: 0, mailboxesRewound: 0 };
	}

	const writes = async (): Promise<{
		partsDropped: number;
		mailboxesRewound: number;
	}> => {
		for (const sql of DROP_DEPENDENT_SQL) {
			await client.run(sql, []);
		}
		const partsDropped = await client.run(DROP_PARTS_SQL, []);
		let mailboxesRewound = 0;
		for (const row of affected) {
			mailboxesRewound += await client.run(REWIND_SQL, [
				row.max_uid + 1,
				row.mailbox_id,
			]);
		}
		return { partsDropped, mailboxesRewound };
	};

	await client.run("BEGIN IMMEDIATE", []);
	const written = await writes().catch(async (error: unknown) => {
		await client.run("ROLLBACK", []);
		throw error;
	});
	await client.run("COMMIT", []);

	return { ...found, ...written };
};

export const formatForwardedPartsReport = (
	report: ForwardedPartsReport,
): string[] => {
	if (report.messages === 0) {
		return ["No forwarded message has lost its part row"];
	}
	if (report.mode === "check") {
		return [
			`${report.messages} message(s) in ${report.mailboxes} folder(s) lost their forwarded message's part row; their parts would be dropped and re-synced`,
		];
	}
	return [
		`${report.partsDropped} part row(s) of ${report.messages} message(s) dropped; ${report.mailboxesRewound} of ${report.mailboxes} folder(s) set to re-sync them`,
	];
};
