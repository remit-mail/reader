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
	readonly partsDropped: number;
};

const AFFECTED_SQL = `SELECT DISTINCT message_id FROM body_part
WHERE parent_body_part_id = body_part_id
ORDER BY message_id`;

const PART_TABLES = [
	"body_part_parameter",
	"body_part_storage",
	"body_part",
] as const;

/** Well under SQLite's bound-parameter limit. */
const CHUNK = 500;

const chunks = (ids: readonly string[]): string[][] => {
	const out: string[][] = [];
	for (let i = 0; i < ids.length; i += CHUNK) {
		out.push(ids.slice(i, i + CHUNK));
	}
	return out;
};

/**
 * One transaction, so a message never keeps half of its part rows and is never
 * left without parts and off the queue. The rows that hang off a part go
 * before the part rows themselves.
 */
export const sweepForwardedMessageParts = async (
	client: ForwardedPartsRepairClient,
	mode: ForwardedPartsRepairMode,
): Promise<ForwardedPartsReport> => {
	const messageIds = (
		(await client.all(AFFECTED_SQL, [])) as { message_id: string }[]
	).map((row) => row.message_id);

	if (mode === "check" || messageIds.length === 0) {
		return { mode, messages: messageIds.length, partsDropped: 0 };
	}

	const drop = async (): Promise<number> => {
		let partsDropped = 0;
		const now = Date.now();
		for (const ids of chunks(messageIds)) {
			const placeholders = ids.map(() => "?").join(", ");
			await client.run(
				`INSERT OR IGNORE INTO body_structure_refetch (message_id, created_at, updated_at)
SELECT message_id, ?, ? FROM message WHERE message_id IN (${placeholders})`,
				[now, now, ...ids],
			);
			for (const table of PART_TABLES) {
				const dropped = await client.run(
					`DELETE FROM ${table} WHERE message_id IN (${placeholders})`,
					ids,
				);
				if (table === "body_part") partsDropped += dropped;
			}
		}
		return partsDropped;
	};

	await client.run("BEGIN IMMEDIATE", []);
	const partsDropped = await drop().catch(async (error: unknown) => {
		await client.run("ROLLBACK", []);
		throw error;
	});
	await client.run("COMMIT", []);

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
