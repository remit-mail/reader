/**
 * The repair for `thread_message.category` (#321, D16 and D17 of
 * `docs/design/mail-list-server-query.md`).
 *
 * `thread_message.category` is a denormalized copy of `message.category`. The
 * read path never used it, so nothing ever depended on its write path being
 * complete, and it has drifted. #304 makes it the SQL predicate behind the
 * inbox category filter, so it has to be correct on every existing instance
 * before that read path goes live — otherwise the filter under-returns mail
 * with nothing masking it.
 *
 * One set-based statement. The value it copies is reachable through
 * `message`'s primary key, so the write is single-valued by construction and
 * there is no checkpointing, batching or resumability here: an interrupted run
 * leaves a consistent table and the next start finishes the job.
 *
 * The statement runs only when the check found something to repair. SQLite takes
 * its exclusive write lock when an UPDATE begins, before it can know the WHERE
 * matches nothing, so an unconditional statement would take that lock on every
 * boot forever — and a lock it cannot acquire within the migrator's
 * `busy_timeout` fails the migration and holds every gated service down. The
 * steady state after the first run is zero, so the skip is the normal path.
 *
 * Two things the statement will not do, both because the repair must never
 * leave a row worse than it found it:
 *
 *  - It never copies `uncategorized` over a classified row. `message` is the
 *    authority, but a pending message holds nothing to copy, and after #326
 *    body-sync writes the row before the message, so a classification in flight
 *    is legitimately `ahead` of its message for a moment. Pushing it back would
 *    undo a correct classification and, on the read path #328 builds, serve
 *    `Unclassified` for mail that is already classified. Counted as `ahead`.
 *  - It never overwrites a row that was written after the statement began. The
 *    migrate one-shot normally runs with every app service stopped, but
 *    `docker compose up -d` can restart it while workers still run, so the
 *    quiet window is not assumed. Writers are serialized, so a concurrent
 *    body-sync write lands wholly before or wholly after and both orders
 *    converge on the same value. The `updated_at` guard is the backstop: a row
 *    a concurrent writer touched after the statement began fails the re-check,
 *    so the writer's value stands rather than being reverted.
 *
 * The guard covers a writer whose transaction begins after the statement. A
 * writer that began before it and commits during it carries an older stamp and
 * passes, which would revert its write. Four things have to hold at once for
 * that to lose anything:
 *
 *  1. a row the statement's WHERE matches, so an unrepaired `behind` row;
 *  2. a writer overlapping the statement;
 *  3. that writer's row write committing before the statement began while its
 *     message write commits after it — the two are separate commits;
 *  4. the writer moving `message.category` from one decided value to a
 *     *different* decided value. A first classification cannot lose anything:
 *     `message.category` is still `uncategorized`, so the pending exclusion
 *     above refuses the row outright.
 *
 * Only the fourth is interesting, and it is not impossible. It is reachable
 * through the one path that classifies, which is re-enterable: the skip guard
 * is `if (hasClassifiedBody(message.bodyStorageKey) && !force)` (`body-sync.ts`), and
 * `force` is a live event flag — the read-miss re-arm cue, resolved in the
 * imap-worker's `sync-message-body.ts`. A forced re-fetch re-runs
 * `classifyByHeaders` over the same bytes, so it normally rewrites the value it
 * already held; it decides *differently* only across a release that changed the
 * classifier, which #62 was.
 *
 * So: effectively unreachable, needing a forced re-fetch of a message whose
 * stored classification predates a classifier change, overlapping this
 * statement. Not impossible, and the `crossed` figure is what reports it.
 *
 * The statement does not touch `updated_at`. That column means "when the app
 * last wrote this row", which is what the guard above reads, and a repair that
 * bumped it would both lie about the row and defeat its own guard.
 */

/**
 * The smallest surface the repair needs, so this module imports nothing and can
 * be driven by the migrator's `better-sqlite3` handle or a test harness.
 */
export interface RepairSqlClient {
	all(sql: string): Promise<unknown[]>;
	run(sql: string): Promise<number>;
}

/**
 * The declared pending state, not absence (#45). It must never fold into
 * `personal`, and it is the one value the repair refuses to write over a
 * classified row.
 */
const PENDING = "uncategorized";

const NOW_MILLIS = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

export const repairStatement = (): string =>
	`UPDATE thread_message
SET category = (
	SELECT m.category FROM message m WHERE m.message_id = thread_message.message_id
)
WHERE EXISTS (
	SELECT 1 FROM message m
	WHERE m.message_id = thread_message.message_id
	  AND m.category <> thread_message.category
	  AND m.category <> '${PENDING}'
)
  AND thread_message.updated_at <= ${NOW_MILLIS}`;

const BUCKETS_SQL = `SELECT t.category AS row_category, m.category AS message_category, count(*) AS row_count
FROM thread_message t
JOIN message m ON m.message_id = t.message_id
GROUP BY t.category, m.category`;

const TALLY_SQL = `SELECT category, count(*) AS row_count
FROM thread_message
GROUP BY category
ORDER BY row_count DESC, category ASC`;

const BY_MAILBOX_SQL = `SELECT t.mailbox_id AS mailbox_id, count(*) AS row_count
FROM thread_message t
JOIN message m ON m.message_id = t.message_id
WHERE m.category <> t.category
GROUP BY t.mailbox_id
ORDER BY row_count DESC, mailbox_id ASC`;

const FAN_OUT_SQL = `SELECT count(*) AS message_count, coalesce(sum(row_count), 0) AS row_total
FROM (
	SELECT message_id, count(*) AS row_count
	FROM thread_message
	GROUP BY message_id
	HAVING count(*) > 1
) fan_out`;

/**
 * The residual after a repair, split by why the row was left. A row skipped
 * because a writer touched it during the statement is repaired on the next run;
 * a row whose `updated_at` is ahead of the database clock fails the guard on
 * every run until the stamp is corrected, which is a different thing to tell an
 * operator and would otherwise be indistinguishable in the output.
 */
const residualSql = (): string =>
	`SELECT count(*) AS row_count,
	coalesce(sum(CASE WHEN t.updated_at > ${NOW_MILLIS} THEN 1 ELSE 0 END), 0) AS ahead_of_clock
FROM thread_message t
JOIN message m ON m.message_id = t.message_id
WHERE m.category <> t.category
  AND m.category <> '${PENDING}'`;

export type CategoryCount = {
	readonly category: string;
	readonly rows: number;
};

export type MailboxCount = {
	readonly mailboxId: string;
	readonly rows: number;
};

/**
 * Divergence split by direction, because the direction is the cause. A repair
 * that never ran and a corpus that was already correct both report
 * `divergent: 0`; only the per-cause figures tell them apart, and only the
 * per-cause expectations say which zeros are the healthy answer.
 *
 *  - `behind` — the row is pending, its message is classified. Every one of the
 *    three write-path defects #326 fixes lands here, and this is the cohort the
 *    repair exists for.
 *  - `crossed` — both classified, differently. No write path leaves a row here:
 *    the row and the message take the same `classifyByHeaders` value off the
 *    same bytes in the same pass, so a re-classification moves both.
 *  - `ahead` — the row is classified, its message is pending. After #326 that is
 *    a classification in flight, so on a live instance it is expected and
 *    transient. Not repaired.
 */
export type CategoryDivergence = {
	readonly rowsWithMessage: number;
	readonly divergent: number;
	readonly repairable: number;
	readonly behind: number;
	readonly crossed: number;
	readonly ahead: number;
	readonly notYetClassified: number;
};

export type CategoryResidual = {
	readonly repairable: number;
	readonly aheadOfClock: number;
};

export type CategoryDivergenceReport = CategoryDivergence & {
	readonly rows: number;
	readonly orphanRows: number;
	readonly fanOutMessages: number;
	readonly fanOutRows: number;
	readonly divergentByMailbox: readonly MailboxCount[];
	readonly categoryTally: readonly CategoryCount[];
};

export type RepairResult = {
	readonly rowsWritten: number;
	readonly elapsedMs: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const columnOf = (row: unknown, column: string): unknown => {
	if (!isRecord(row)) {
		throw new Error(
			`thread_message.category check: expected a row object, received ${JSON.stringify(row)}`,
		);
	}
	return row[column];
};

// A driver may hand back a bigint aggregate as a string, so a count is a number
// or the decimal text of one, and anything else is a query that changed shape.
const countOf = (row: unknown, column: string): number => {
	const value = columnOf(row, column);
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/.test(value)) {
		return Number(value);
	}
	throw new Error(
		`thread_message.category check: expected a count in "${column}", received ${JSON.stringify(value)}`,
	);
};

const textOf = (row: unknown, column: string): string => {
	const value = columnOf(row, column);
	if (typeof value === "string") {
		return value;
	}
	throw new Error(
		`thread_message.category check: expected text in "${column}", received ${JSON.stringify(value)}`,
	);
};

const sum = (values: readonly number[]): number =>
	values.reduce((total, value) => total + value, 0);

/**
 * One grouped scan of the join answers every divergence figure, so the check
 * costs two aggregate passes over `thread_message` rather than one per number.
 */
export const readDivergence = async (
	client: RepairSqlClient,
): Promise<CategoryDivergence> => {
	const buckets = (await client.all(BUCKETS_SQL)).map((row) => ({
		rowCategory: textOf(row, "row_category"),
		messageCategory: textOf(row, "message_category"),
		rows: countOf(row, "row_count"),
	}));

	const total = (
		predicate: (bucket: (typeof buckets)[number]) => boolean,
	): number => sum(buckets.filter(predicate).map((bucket) => bucket.rows));

	const behind = total(
		(bucket) =>
			bucket.rowCategory === PENDING && bucket.messageCategory !== PENDING,
	);
	const crossed = total(
		(bucket) =>
			bucket.rowCategory !== PENDING &&
			bucket.messageCategory !== PENDING &&
			bucket.rowCategory !== bucket.messageCategory,
	);
	const ahead = total(
		(bucket) =>
			bucket.rowCategory !== PENDING && bucket.messageCategory === PENDING,
	);

	return {
		rowsWithMessage: total(() => true),
		divergent: total((bucket) => bucket.rowCategory !== bucket.messageCategory),
		repairable: behind + crossed,
		behind,
		crossed,
		ahead,
		notYetClassified: total(
			(bucket) =>
				bucket.rowCategory === PENDING && bucket.messageCategory === PENDING,
		),
	};
};

export const checkThreadMessageCategory = async (
	client: RepairSqlClient,
): Promise<CategoryDivergenceReport> => {
	const divergence = await readDivergence(client);

	const categoryTally = (await client.all(TALLY_SQL)).map((row) => ({
		category: textOf(row, "category"),
		rows: countOf(row, "row_count"),
	}));

	const divergentByMailbox = (await client.all(BY_MAILBOX_SQL)).map((row) => ({
		mailboxId: textOf(row, "mailbox_id"),
		rows: countOf(row, "row_count"),
	}));

	const [fanOut] = await client.all(FAN_OUT_SQL);

	const rows = sum(categoryTally.map((entry) => entry.rows));

	return {
		...divergence,
		rows,
		orphanRows: rows - divergence.rowsWithMessage,
		fanOutMessages: countOf(fanOut, "message_count"),
		fanOutRows: countOf(fanOut, "row_total"),
		divergentByMailbox,
		categoryTally,
	};
};

export const repairThreadMessageCategory = async (
	client: RepairSqlClient,
): Promise<RepairResult> => {
	const startedAt = Date.now();
	const rowsWritten = await client.run(repairStatement());
	return { rowsWritten, elapsedMs: Date.now() - startedAt };
};

export const readResidual = async (
	client: RepairSqlClient,
): Promise<CategoryResidual> => {
	const [row] = await client.all(residualSql());
	return {
		repairable: countOf(row, "row_count"),
		aheadOfClock: countOf(row, "ahead_of_clock"),
	};
};

const plural = (rows: number): string => (rows === 1 ? "row" : "rows");

/**
 * Every figure carries the cause it measures and the result a healthy instance
 * is expected to produce. Most of them are legitimately zero, so a bare `0`
 * cannot be told apart from a repair that never ran — and a cause an operator
 * can rule out by inspection is worse than no cause at all, because it reads as
 * a broken figure.
 */
export const formatCheckReport = (
	report: CategoryDivergenceReport,
): string[] => [
	`thread_message rows: ${report.rows} (${report.rowsWithMessage} with a message row)`,
	`divergent (thread_message.category <> message.category): ${report.divergent}, of which ${report.repairable} repairable`,
	`  behind: ${report.behind} ${plural(report.behind)} pending against a classified message — the copy of a decided category never landed. All three of the write-path defects #326 fixes end here: a retro classification stranded between its two writes, a denormalize that wrote one of several rows for a message, and a row created for a message that was already classified. Repaired, and this is the cohort the repair exists for. Expected non-zero on an instance where any of those fired, zero otherwise.`,
	`  crossed: ${report.crossed} ${plural(report.crossed)} classified differently from the message — no write path leaves a row here: both take the same classifyByHeaders value off the same bytes in the same pass, so a re-classification moves the row and the message together. Repaired. Expected zero; a non-zero means the pair was interrupted between its two writes — a forced re-fetch that re-decided the category and died before the message write — or the database was edited outside the app.`,
	`  ahead: ${report.ahead} ${plural(report.ahead)} classified against a pending message — after #326 body-sync writes the row before the message, so this is a classification in flight. Not repaired: pushing it back to pending would undo a correct classification and serve Unclassified for mail that is already classified. Expected non-zero on a live instance mid-sync, zero on a quiescent one.`,
	`fan-out: ${report.fanOutMessages} messages holding ${report.fanOutRows} thread_message rows — the multi-row shape #326 hardens against. Expected zero: deriveMessageId and deriveThreadMessageId are both mailbox-independent, so a message in two mailboxes collapses to one row, and the reachable case is thread-root drift.`,
	`orphans: ${report.orphanRows} ${plural(report.orphanRows)} with no message row — not repaired, nothing to copy. Expected zero.`,
	`not-yet-classified: ${report.notYetClassified} ${plural(report.notYetClassified)} pending against a pending message — not classified yet. Not a defect, not touched by the repair, and unchanged by it. Expected non-zero on a live instance.`,
	`divergent per mailbox: ${
		report.divergentByMailbox.length === 0
			? "none"
			: report.divergentByMailbox
					.map((entry) => `${entry.mailboxId}=${entry.rows}`)
					.join(" ")
	}`,
	`category tally: ${
		report.categoryTally.length === 0
			? "none"
			: report.categoryTally
					.map((entry) => `${entry.category}=${entry.rows}`)
					.join(" ")
	}`,
];

/**
 * The next run of the repair is the next start of the migrate one-shot, which on
 * a self-host instance means the next `remit update` — weeks, not minutes. A
 * residual is therefore named as something an operator may have to act on, not
 * as something that clears itself shortly.
 */
export const formatRepairResult = (
	result: RepairResult,
	residual: CategoryResidual,
): string[] => {
	const lines = [
		`repair wrote ${result.rowsWritten} ${plural(result.rowsWritten)} in ${result.elapsedMs}ms`,
		`residual repairable divergence: ${residual.repairable} (expected zero)`,
	];
	if (residual.repairable === 0) {
		return lines;
	}

	const concurrent = residual.repairable - residual.aheadOfClock;
	if (concurrent > 0) {
		lines.push(
			`WARNING: ${concurrent} ${plural(concurrent)} skipped because a writer touched them while the repair ran. The writer's value stands, which is correct, but the copy is only rechecked the next time this one-shot runs — the next 'remit update' — and until then the mail list serves that row's category as it now stands.`,
		);
	}
	if (residual.aheadOfClock > 0) {
		lines.push(
			`WARNING: ${residual.aheadOfClock} ${plural(residual.aheadOfClock)} carry an updated_at ahead of the database clock, so they fail the repair's guard on every run, not just this one. That is a clock that jumped, a restored backup, or a host whose time was wrong — not a concurrent writer. They stay divergent until the stamp is corrected.`,
		);
	}
	return lines;
};

/**
 * The repair is skipped outright when the check found nothing to write, because
 * SQLite takes the exclusive write lock when an UPDATE begins — before it can
 * know the WHERE matches nothing. The steady state is zero, so without this
 * every boot would take that lock, and a lock it cannot acquire within
 * busy_timeout fails the migration and holds every gated service down. The
 * figures the skip is decided on were just read; a row that diverges in the
 * moment between is skipped by the guard anyway and repaired on the next run.
 */
export const formatRepairSkipped = (
	divergence: CategoryDivergence,
): string[] => [
	`repair skipped: nothing repairable (${divergence.divergent} divergent, ${divergence.ahead} of them a classification in flight). No write, so no write lock is taken.`,
];
