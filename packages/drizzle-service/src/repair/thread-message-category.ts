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
 * One set-based statement per dialect. The value is a primary-key probe away
 * in the same database, so there is no checkpointing, batching or resumability
 * here: an interrupted run leaves a consistent table and the next start
 * finishes the job.
 *
 * Two things the statement will not do, both because the repair must never
 * leave a row worse than it found it:
 *
 *  - It never copies `uncategorized` over a classified row. `message` is the
 *    authority, and a pending message holds nothing to copy; overwriting would
 *    discard the only classification the instance has. Reported as `reverse`
 *    instead.
 *  - It never overwrites a row that was written after the statement began. The
 *    migrate one-shot normally runs with every app service stopped, but
 *    `docker compose up -d` can restart it while workers still run, so the
 *    quiet window is not assumed. On SQLite writers are serialized, so a
 *    concurrent body-sync write lands wholly before or wholly after and both
 *    orders converge on the same value. On Postgres READ COMMITTED an UPDATE
 *    re-evaluates its WHERE clause against the version a concurrent
 *    transaction just committed, but still reads other tables at its original
 *    snapshot — so without the `updated_at` guard it could write a
 *    pre-classification value over the fresh one. The guard makes that row
 *    fail the re-check and body-sync's value wins; the row is repaired on the
 *    next start if it needed it.
 *
 * The statement does not touch `updated_at`. That column means "when the app
 * last wrote this row", which is what the guard above reads, and a repair that
 * bumped it would both lie about the row and defeat its own guard.
 */

export type RepairDialect = "sqlite" | "postgres";

/**
 * The smallest surface the repair needs, so this module imports nothing and can
 * be driven by the migrator's `better-sqlite3` handle, its `pg.Pool`, or a test
 * harness of either dialect.
 */
export interface RepairSqlClient {
	readonly dialect: RepairDialect;
	all(sql: string): Promise<unknown[]>;
	run(sql: string): Promise<number>;
}

/**
 * The declared pending state, not absence (#45). It must never fold into
 * `personal`, and it is the one value the repair refuses to write over a
 * classified row.
 */
const PENDING = "uncategorized";

const nowMillis = (dialect: RepairDialect): string =>
	dialect === "sqlite"
		? "CAST(unixepoch('subsec') * 1000 AS INTEGER)"
		: "CAST(EXTRACT(EPOCH FROM now()) * 1000 AS bigint)";

export const repairStatement = (dialect: RepairDialect): string =>
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
  AND thread_message.updated_at <= ${nowMillis(dialect)}`;

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

export type CategoryCount = {
	readonly category: string;
	readonly rows: number;
};

export type MailboxCount = {
	readonly mailboxId: string;
	readonly rows: number;
};

/**
 * Divergence split by cause, so a zero is a measurement rather than an
 * ambiguity. A repair that never ran and a corpus that was already correct both
 * report `divergent: 0`; only the per-cause figures tell them apart, and only
 * the per-cause expectations say which zeros are the healthy answer.
 */
export type CategoryDivergence = {
	readonly rowsWithMessage: number;
	readonly divergent: number;
	readonly repairable: number;
	readonly historical: number;
	readonly crossed: number;
	readonly reverse: number;
	readonly notYetClassified: number;
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

// node-postgres hands back bigint aggregates as strings, so a count is a number
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

	const historical = total(
		(bucket) =>
			bucket.rowCategory === PENDING && bucket.messageCategory !== PENDING,
	);
	const crossed = total(
		(bucket) =>
			bucket.rowCategory !== PENDING &&
			bucket.messageCategory !== PENDING &&
			bucket.rowCategory !== bucket.messageCategory,
	);
	const reverse = total(
		(bucket) =>
			bucket.rowCategory !== PENDING && bucket.messageCategory === PENDING,
	);

	return {
		rowsWithMessage: total(() => true),
		divergent: total((bucket) => bucket.rowCategory !== bucket.messageCategory),
		repairable: historical + crossed,
		historical,
		crossed,
		reverse,
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
	const rowsWritten = await client.run(repairStatement(client.dialect));
	return { rowsWritten, elapsedMs: Date.now() - startedAt };
};

const plural = (rows: number): string => (rows === 1 ? "row" : "rows");

/**
 * Every figure carries the cause it measures and the result a healthy instance
 * is expected to produce, because most of these are legitimately zero: both
 * derived ids are mailbox-independent, so a message in two mailboxes collapses
 * to one `thread_message` row and the multi-row fan-out is structurally absent.
 * A bare `0` cannot distinguish that from a repair that never ran.
 */
export const formatCheckReport = (
	report: CategoryDivergenceReport,
): string[] => [
	`thread_message rows: ${report.rows} (${report.rowsWithMessage} with a message row)`,
	`divergent (thread_message.category <> message.category): ${report.divergent}, of which ${report.repairable} repairable`,
	`  historical: ${report.historical} ${plural(report.historical)} pending against a classified message — mail classified before the denormalized column landed (2026-07-08), plus any Postgres instance whose column was added with its 'uncategorized' default and stamped without consulting message.category. Repaired. Expected non-zero on an instance that classified mail before that date, zero on a newer install.`,
	`  crossed: ${report.crossed} ${plural(report.crossed)} classified differently from the message — a denormalize that never completed (#326). Repaired. Expected zero.`,
	`  reverse: ${report.reverse} ${plural(report.reverse)} classified against a pending message — not repaired, message is the authority and holds nothing to copy. Expected zero.`,
	`fan-out: ${report.fanOutMessages} messages holding ${report.fanOutRows} thread_message rows — the multi-row shape #326 hardens against. Expected zero: deriveMessageId and deriveThreadMessageId are both mailbox-independent, so a message in two mailboxes collapses to one row.`,
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

export const formatRepairResult = (
	result: RepairResult,
	residual: CategoryDivergence,
): string[] => {
	const lines = [
		`repair wrote ${result.rowsWritten} ${plural(result.rowsWritten)} in ${result.elapsedMs}ms`,
		`residual repairable divergence: ${residual.repairable} (expected zero)`,
	];
	if (residual.repairable > 0) {
		lines.push(
			`WARNING: divergence remains on ${residual.repairable} ${plural(residual.repairable)}. A row written while the repair ran is skipped so the concurrent writer's value stands; it is repaired on the next start.`,
		);
	}
	return lines;
};
