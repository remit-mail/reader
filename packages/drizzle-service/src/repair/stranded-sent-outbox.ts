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
 * Two different things strand a row, and `appended_uid` is what tells them
 * apart (issue #858). At `0` the APPEND was never confirmed: the message is in
 * no folder, and `unfiled` with an error the user can read is the honest
 * outcome. At anything else the copy is in the user's Sent folder and only the
 * delete that follows the APPEND failed, so the row is a leftover — marking it
 * `unfiled` would tell the user a message that is sitting in Sent was never
 * filed, and show it to them twice. Those rows are dropped instead, finishing
 * the delete the handler owed. Their attachment objects are collected by the
 * scheduler's attachment sweep, which is where every object that outlives its
 * row already ends up.
 *
 * The age bound is what separates a stranded row from an ordinary one. A
 * message sent seconds before a restart has its APPEND event still queued, and
 * that event settles the row itself once the workers come back; rewriting it
 * here would take a filing that was about to succeed. An hour is far past any
 * redrive budget, so a row older than that has no event coming.
 *
 * No message content is touched, and nothing is dropped that the mail server is
 * not already holding a copy of.
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
	/** Stranded rows whose APPEND was never confirmed. */
	readonly neverFiled: number;
	/** Stranded rows whose copy reached Sent and whose delete did not. */
	readonly filed: number;
	readonly settled: number;
	readonly dropped: number;
};

/**
 * One hour. A row younger than this may still have its APPEND event in the
 * queue, and that event settles the row correctly on its own.
 */
export const STRANDED_AFTER_MILLIS = 60 * 60 * 1000;

const STRANDED_SENT_REASON =
	"Sent, but not filed: filing a copy in the Sent folder never completed. The message was delivered.";

/**
 * The cutoff is computed once and bound to all four statements, rather than
 * each of them subtracting the age bound from its own `unixepoch()`. Four
 * clocks give four different populations: a row that crosses the hour between
 * the count and a write, or between the two deletes, is counted and not written
 * or has its files taken and its row left.
 */
const STRANDED = "status = 'sent' AND coalesce(sent_at, updated_at) < ?";

/**
 * `isSentCopyFiled` in @remit/data-ports, in SQL. Only the two values that mean
 * "filed" say so, so a value neither writes reads as unfiled — which settles a
 * row rather than dropping it.
 */
const FILED_UID = "(appended_uid > 0 OR appended_uid = -1)";

const NEVER_FILED = `${STRANDED} AND NOT ${FILED_UID}`;

const FILED = `${STRANDED} AND ${FILED_UID}`;

const COUNT_SQL = `SELECT
	coalesce(sum(CASE WHEN NOT ${FILED_UID} THEN 1 ELSE 0 END), 0) AS never_filed,
	coalesce(sum(CASE WHEN ${FILED_UID} THEN 1 ELSE 0 END), 0) AS filed
FROM outbox_message
WHERE ${STRANDED}`;

const SETTLE_SQL = `UPDATE outbox_message
SET status = 'unfiled', last_error = ?
WHERE ${NEVER_FILED}`;

const DROP_ATTACHMENTS_SQL = `DELETE FROM outbox_attachment
WHERE outbox_message_id IN (
	SELECT outbox_message_id FROM outbox_message WHERE ${FILED}
)`;

const DROP_MESSAGES_SQL = `DELETE FROM outbox_message
WHERE ${FILED}`;

const countStranded = async (
	client: StrandedSentRepairClient,
	strandedBefore: number,
): Promise<{ neverFiled: number; filed: number }> => {
	const [row] = (await client.all(COUNT_SQL, [strandedBefore])) as {
		never_filed: number;
		filed: number;
	}[];
	return { neverFiled: row?.never_filed ?? 0, filed: row?.filed ?? 0 };
};

/**
 * Each write runs only when the count found rows for it. SQLite takes its
 * exclusive write lock the moment a statement begins, before it can know the
 * WHERE matches nothing, and a lock the migrator cannot get inside its
 * `busy_timeout` fails the migration and holds every gated service down. Zero
 * is the steady state.
 *
 * The attachment rows go before the message rows they hang off. Reversed, a
 * crash between the two statements leaves attachment rows naming a message that
 * no longer exists — nothing would ever find them again, and their objects would
 * be vouched for forever.
 */
export const sweepStrandedSentOutbox = async (
	client: StrandedSentRepairClient,
	mode: StrandedSentRepairMode,
): Promise<StrandedSentReport> => {
	const strandedBefore = Date.now() - STRANDED_AFTER_MILLIS;
	const { neverFiled, filed } = await countStranded(client, strandedBefore);
	const stranded = neverFiled + filed;
	const nothingWritten = { mode, stranded, neverFiled, filed } as const;

	if (mode === "check" || stranded === 0) {
		return { ...nothingWritten, settled: 0, dropped: 0 };
	}

	const settled =
		neverFiled === 0
			? 0
			: await client.run(SETTLE_SQL, [STRANDED_SENT_REASON, strandedBefore]);

	if (filed === 0) {
		return { ...nothingWritten, settled, dropped: 0 };
	}

	await client.run(DROP_ATTACHMENTS_SQL, [strandedBefore]);
	const dropped = await client.run(DROP_MESSAGES_SQL, [strandedBefore]);

	return { ...nothingWritten, settled, dropped };
};

export const formatStrandedSentReport = (
	report: StrandedSentReport,
): string[] => {
	if (report.stranded === 0) {
		return ["No sent message is stranded in the outbox"];
	}

	const lines: string[] = [];
	if (report.mode === "check") {
		if (report.neverFiled > 0) {
			lines.push(
				`${report.neverFiled} sent message(s) stranded in the outbox, would be marked unfiled`,
			);
		}
		if (report.filed > 0) {
			lines.push(
				`${report.filed} sent message(s) already filed in Sent, their outbox row would be dropped`,
			);
		}
		return lines;
	}

	if (report.neverFiled > 0) {
		lines.push(
			`${report.settled} of ${report.neverFiled} stranded sent message(s) marked unfiled`,
		);
	}
	if (report.filed > 0) {
		lines.push(
			`${report.dropped} of ${report.filed} already-filed sent message(s) dropped from the outbox`,
		);
	}
	return lines;
};
