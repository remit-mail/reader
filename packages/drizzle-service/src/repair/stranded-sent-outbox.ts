/**
 * The repair for outbox rows stranded at `sent` (issue #824).
 *
 * A row holds `sent` only between SMTP accepting the message and the IMAP
 * APPEND that files a copy in Sent, whose last act is to delete the row. Every
 * way that APPEND could fail used to end in a silent return, so the row stayed
 * at `sent` forever — and `sent` is the one non-draft status the Outbox list
 * hides, on the assumption that the APPEND deletes it. The message was
 * delivered, exists in no server folder, and appears in no view.
 *
 * The handler now settles those failures as `unfiled`. That reaches nothing
 * already stranded: the events are long gone, and the rows are on instances
 * that only an image update reaches. So the same settlement is applied here,
 * once, at boot — the migrate one-shot is the only step every self-host
 * instance runs before its app containers start (#281).
 *
 * The age bound is what separates a stranded row from an ordinary one. A
 * message sent seconds before a restart has its APPEND event still queued, and
 * that event settles the row itself once the workers come back; rewriting it
 * here would take a filing that was about to succeed. An hour is far past any
 * redrive budget, so a row older than that has no event coming.
 *
 * It is a status flip and an error string, on rows whose only other outcome is
 * to stay invisible. Nothing is deleted and no message content is touched.
 */

/**
 * The smallest surface this needs, so the module imports no schema and no
 * driver and can be driven by the migrator's `better-sqlite3` handle or a test.
 */
export interface StrandedSentRepairClient {
	all(sql: string, params: unknown[]): Promise<unknown[]>;
	run(sql: string, params: unknown[]): Promise<number>;
}

export type StrandedSentRepairMode = "check" | "repair";

export type StrandedSentReport = {
	readonly mode: StrandedSentRepairMode;
	readonly stranded: number;
	readonly settled: number;
};

/**
 * One hour. A row younger than this may still have its APPEND event in the
 * queue, and that event settles the row correctly on its own.
 */
export const STRANDED_AFTER_MILLIS = 60 * 60 * 1000;

const STRANDED_SENT_REASON =
	"Sent, but not filed: filing a copy in the Sent folder never completed. The message was delivered.";

const NOW_MILLIS = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

const AGE = `coalesce(sent_at, updated_at) < ${NOW_MILLIS} - ?`;

const COUNT_SQL = `SELECT count(*) AS row_count
FROM outbox_message
WHERE status = 'sent' AND ${AGE}`;

const SETTLE_SQL = `UPDATE outbox_message
SET status = 'unfiled', last_error = ?
WHERE status = 'sent' AND ${AGE}`;

const countStranded = async (
	client: StrandedSentRepairClient,
): Promise<number> => {
	const [row] = (await client.all(COUNT_SQL, [STRANDED_AFTER_MILLIS])) as {
		row_count: number;
	}[];
	return row?.row_count ?? 0;
};

/**
 * The UPDATE runs only when the count found rows. SQLite takes its exclusive
 * write lock the moment an UPDATE begins, before it can know the WHERE matches
 * nothing, and a lock the migrator cannot get inside its `busy_timeout` fails
 * the migration and holds every gated service down. Zero is the steady state.
 */
export const sweepStrandedSentOutbox = async (
	client: StrandedSentRepairClient,
	mode: StrandedSentRepairMode,
): Promise<StrandedSentReport> => {
	const stranded = await countStranded(client);
	if (mode === "check" || stranded === 0) {
		return { mode, stranded, settled: 0 };
	}
	const settled = await client.run(SETTLE_SQL, [
		STRANDED_SENT_REASON,
		STRANDED_AFTER_MILLIS,
	]);
	return { mode, stranded, settled };
};

export const formatStrandedSentReport = (
	report: StrandedSentReport,
): string[] => {
	if (report.stranded === 0) {
		return ["No sent message is stranded in the outbox"];
	}
	if (report.mode === "check") {
		return [
			`${report.stranded} sent message(s) stranded in the outbox, would be marked unfiled`,
		];
	}
	return [
		`${report.settled} of ${report.stranded} stranded sent message(s) marked unfiled`,
	];
};
