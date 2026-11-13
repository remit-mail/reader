import { createHash } from "node:crypto";
import type { SqliteConnection } from "@remit/drizzle-service/sqlite";

type Handle = SqliteConnection;

export const firstValue = (row: unknown): unknown =>
	row === undefined ? undefined : Object.values(row as object)[0];

/**
 * What the in-place migration of a v0.9 remit.db removes, each with the
 * migration that removes it. Everything else is carried over unchanged, and
 * the verification below fails on any other table or column that goes missing.
 */
export const DROPPED_TABLES: ReadonlyMap<string, string> = new Map([
	["filter_anchor", "entities 0043"],
	["outbox", "entities 0043"],
	["body_part_content", "entities 0044"],
	["body_part_storage", "mail 0004"],
]);

export const DROPPED_COLUMNS: ReadonlyMap<string, string> = new Map([
	["filter.has_anchor", "entities 0043"],
	["organize_job_request.anchor_message_id", "entities 0043"],
	["organize_job_request.similarity_threshold", "entities 0043"],
	["message.message_id_header", "entities 0040"],
	["message.authenticity_verdict", "mail 0016"],
]);

/** Columns the migration adds to a table that already holds rows: all NULL. */
export const ADDED_COLUMNS: ReadonlyMap<string, string> = new Map([
	["auth_jwks.alg", "auth 0001"],
	["auth_jwks.crv", "auth 0001"],
]);

/** Columns the migration adds with a value on every row: never NULL. */
export const FILLED_COLUMNS: ReadonlyMap<string, string> = new Map([
	["auth_user.disabled", "app 0002"],
	["auth_user.last_sign_in_at", "app 0002"],
	["filter.rule", "app 0003"],
	["filter.priority", "app 0004"],
	["filter.stop", "app 0004"],
	["organize_job_request.rule", "mail 0009"],
	["message.classifier_scores", "mail 0010"],
	["organize_job_request.source_mailbox_id", "mail 0012"],
	["organize_job_request.sent_after", "mail 0013"],
	["organize_job_request.sent_before", "mail 0013"],
	["message.spam_verdict", "mail 0014"],
]);

/**
 * Rebuilt from the mail rows, or the migrators' own bookkeeping: neither is
 * data the migration has to carry.
 */
export const isDerivedTable = (table: string): boolean =>
	table.startsWith("thread_message_fts") ||
	table.startsWith("__drizzle_migrations_") ||
	table.startsWith("sqlite_");

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

interface ColumnInfo {
	name: string;
	pk: number;
}

const tablesOf = (db: Handle): string[] =>
	db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
		)
		.all()
		.map(firstValue) as string[];

const columnsOf = (db: Handle, table: string): ColumnInfo[] =>
	db
		.prepare("SELECT name, pk FROM pragma_table_info(?) ORDER BY cid")
		.all(table) as ColumnInfo[];

const idsOf = (db: Handle, sql: string): string[] =>
	db.prepare(sql).all().map(firstValue) as string[];

interface Query {
	id: string;
	before: string;
	after: string;
}

interface Digest {
	rows: number;
	sha: string;
}

const digest = (db: Handle, sql: string): Digest => {
	const hash = createHash("sha256");
	let rows = 0;
	for (const row of db.prepare(sql).iterate()) {
		hash.update(JSON.stringify(Object.values(row as object)));
		hash.update("\n");
		rows++;
	}
	return { rows, sha: hash.digest("hex") };
};

interface TableRule {
	except?: readonly string[];
	before?: string;
}

/**
 * Rows the migration changes on purpose, left out of the row comparison and
 * checked on their own below: clause-less filters are deleted (entities 0043)
 * and `thread_message.is_deleted` is cleared where the message was never
 * expunged (mail 0005).
 */
const TABLE_RULES: Readonly<Record<string, TableRule>> = {
	filter: { before: "literal_clauses <> '[]'" },
	thread_message: { except: ["is_deleted"] },
};

const NAMED_COLUMNS: ReadonlyArray<{
	id: string;
	table: string;
	columns: readonly string[];
	where?: string;
}> = [
	{
		id: "V1 filters kept",
		table: "filter",
		columns: [
			"filter_id",
			"account_config_id",
			"name",
			"scope",
			"expires_at",
			"ttl",
			"state",
			"disabled_reason",
			"rule_changed_at",
			"action_changed_at",
			"match_operator",
			"literal_clauses",
			"action_label_id",
			"action_mailbox_id",
			"created_at",
			"updated_at",
		],
	},
	{
		id: "V5 messages",
		table: "message",
		columns: [
			"message_id",
			"mailbox_id",
			"uid",
			"status",
			"sync_status",
			"original_mailbox_id",
			"original_uid",
			"body_storage_key",
			"moved_by_remit",
			"placement_verdict",
			"filter_move",
			"placement_decided_at",
			"classification_state",
			"abandoned_mutation",
			"category",
		],
	},
	{
		id: "V7 cursors",
		table: "mailbox",
		columns: [
			"mailbox_id",
			"full_path",
			"uid_validity",
			"uid_next",
			"highest_modseq",
			"last_sync_uid",
			"high_water_mark_uid",
			"initial_sync_completed_at",
			"cursor_state",
			"pending_path",
		],
	},
	{
		id: "V10 moving and deleting",
		table: "message",
		columns: ["message_id", "status"],
		where: "status IN ('moving','deleting')",
	},
];

const WHOLE_TABLES: ReadonlyArray<{ id: string; tables: readonly string[] }> = [
	{ id: "V8 thread rows", tables: ["thread_message"] },
	{ id: "V9 organize jobs", tables: ["organize_job_request"] },
	{
		id: "V10 pending mutations",
		tables: ["message_flag_push", "message_placement_move"],
	},
	{
		id: "V11 accounts and auth",
		tables: [
			"account",
			"account_config",
			"account_setting",
			"auth_user",
			"auth_account",
			"auth_session",
			"auth_verification",
			"auth_jwks",
		],
	},
	{
		id: "V12 calendars",
		tables: [
			"calendar",
			"calendar_object",
			"calendar_event_index",
			"calendar_feed_token",
			"calendar_suggestion",
		],
	},
];

const BOTH_SIDES: ReadonlyArray<{ id: string; sql: string }> = [
	{
		id: "V3 filter folders resolve",
		sql: "SELECT f.filter_id FROM filter f LEFT JOIN mailbox m ON m.mailbox_id = f.action_mailbox_id WHERE f.action_mailbox_id <> 'None' AND m.mailbox_id IS NULL ORDER BY 1",
	},
	{
		id: "V3 filter labels resolve",
		sql: "SELECT f.filter_id FROM filter f LEFT JOIN label l ON l.label_id = f.action_label_id WHERE f.action_label_id <> 'None' AND l.label_id IS NULL ORDER BY 1",
	},
	{
		id: "V6 no refetch",
		sql: "SELECT count(*) FROM message WHERE body_storage_key IS NULL OR body_storage_key = ''",
	},
];

const HIDDEN_THREADS_SQL =
	"SELECT thread_message_id FROM thread_message t WHERE is_deleted = 1 AND NOT EXISTS (SELECT 1 FROM message m WHERE m.message_id = t.message_id AND m.status IN ('deleting','deleted')) ORDER BY 1";
const DELETED_THREADS_SQL =
	"SELECT thread_message_id FROM thread_message WHERE is_deleted = 1 ORDER BY 1";

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length &&
	[...left].sort().every((id, i) => id === [...right].sort()[i]);

export interface VerificationResult {
	pairs: Array<{ id: string; rows: number }>;
	deletedFilters: string[];
}

/**
 * The before half of the verification pairs, read from the v0.9 file before
 * anything is written to it. {@link verifyAfter} runs the same queries on the
 * migrated file and fails on any difference the migration does not make on
 * purpose.
 */
export interface BeforeState {
	columns: ReadonlyMap<string, readonly string[]>;
	queries: readonly Query[];
	digests: ReadonlyMap<string, Digest>;
	filters: readonly string[];
	clauselessFilters: readonly string[];
	hiddenThreads: readonly string[];
	deletedThreads: readonly string[];
}

const selectFor = (
	db: Handle,
	table: string,
	columns: readonly string[],
	where: string | undefined,
): string => {
	const keys = columnsOf(db, table)
		.filter((column) => column.pk > 0)
		.sort((left, right) => left.pk - right.pk)
		.map((column) => column.name)
		.filter((name) => columns.includes(name));
	const order = keys.length > 0 ? keys : columns;
	return `SELECT ${columns.map(quote).join(", ")} FROM ${quote(table)}${
		where ? ` WHERE ${where}` : ""
	} ORDER BY ${order.map(quote).join(", ")}`;
};

const carriedColumns = (
	db: Handle,
	table: string,
	except: readonly string[] = [],
): string[] =>
	columnsOf(db, table)
		.map((column) => column.name)
		.filter(
			(name) =>
				!DROPPED_COLUMNS.has(`${table}.${name}`) && !except.includes(name),
		);

export const captureBefore = (db: Handle): BeforeState => {
	const tables = tablesOf(db).filter((table) => !isDerivedTable(table));
	const columns = new Map(
		tables.map((table) => [
			table,
			columnsOf(db, table).map((column) => column.name),
		]),
	);
	const queries: Query[] = [];
	for (const pair of NAMED_COLUMNS) {
		if (!columns.has(pair.table)) continue;
		const rule = TABLE_RULES[pair.table];
		queries.push({
			id: pair.id,
			before: selectFor(
				db,
				pair.table,
				pair.columns,
				pair.where ?? rule?.before,
			),
			after: selectFor(db, pair.table, pair.columns, pair.where),
		});
	}
	const table = (id: string, name: string): Query => {
		const rule = TABLE_RULES[name] ?? {};
		const carried = carriedColumns(db, name, rule.except);
		return {
			id: `${id}: ${name}`,
			before: selectFor(db, name, carried, rule.before),
			after: selectFor(db, name, carried, undefined),
		};
	};
	const named = new Set<string>();
	for (const pair of WHOLE_TABLES) {
		for (const name of pair.tables) {
			named.add(name);
			if (columns.has(name)) queries.push(table(pair.id, name));
		}
	}
	for (const name of tables) {
		if (named.has(name) || DROPPED_TABLES.has(name)) continue;
		queries.push(table("V13", name));
	}
	for (const pair of BOTH_SIDES) {
		queries.push({ id: pair.id, before: pair.sql, after: pair.sql });
	}

	return {
		columns,
		queries,
		digests: new Map(
			queries.map((query) => [query.id, digest(db, query.before)]),
		),
		filters: idsOf(db, "SELECT filter_id FROM filter ORDER BY 1"),
		clauselessFilters: idsOf(
			db,
			"SELECT filter_id FROM filter WHERE literal_clauses = '[]' ORDER BY 1",
		),
		hiddenThreads: idsOf(db, HIDDEN_THREADS_SQL),
		deletedThreads: idsOf(db, DELETED_THREADS_SQL),
	};
};

const count = (db: Handle, sql: string): number =>
	firstValue(db.prepare(sql).get()) as number;

/**
 * The after half: every pair equal, every removal one the delta lists, every
 * new table empty and every new column NULL. Throws with each difference; the
 * file is migrated by then, so the recovery is the pre-update snapshot.
 */
export const verifyAfter = (
	db: Handle,
	before: BeforeState,
	fileName: string,
): VerificationResult => {
	const problems: string[] = [];
	const after = new Map(
		tablesOf(db)
			.filter((table) => !isDerivedTable(table))
			.map((table) => [
				table,
				columnsOf(db, table).map((column) => column.name),
			]),
	);

	for (const [table, columns] of before.columns) {
		const now = after.get(table);
		if (!now) {
			if (!DROPPED_TABLES.has(table)) problems.push(`${table} was dropped`);
			continue;
		}
		for (const column of columns) {
			if (!now.includes(column) && !DROPPED_COLUMNS.has(`${table}.${column}`)) {
				problems.push(`${table}.${column} was dropped`);
			}
		}
		for (const column of now) {
			if (columns.includes(column)) continue;
			if (FILLED_COLUMNS.has(`${table}.${column}`)) continue;
			if (!ADDED_COLUMNS.has(`${table}.${column}`)) {
				problems.push(`${table}.${column} was added outside the delta`);
				continue;
			}
			const set = count(
				db,
				`SELECT count(*) FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL`,
			);
			if (set > 0) problems.push(`${table}.${column} is set on ${set} rows`);
		}
	}
	for (const table of after.keys()) {
		if (before.columns.has(table)) continue;
		const rows = count(db, `SELECT count(*) FROM ${quote(table)}`);
		if (rows > 0) problems.push(`${table} is new but holds ${rows} rows`);
	}
	for (const dropped of DROPPED_TABLES.keys()) {
		if (after.has(dropped)) problems.push(`${dropped} is still there`);
	}

	const pairs: VerificationResult["pairs"] = [];
	for (const query of before.queries) {
		const was = before.digests.get(query.id);
		const now = digest(db, query.after);
		if (!was || was.sha !== now.sha) {
			problems.push(
				`${query.id}: ${was?.rows ?? 0} rows before and ${now.rows} after, and they differ`,
			);
			continue;
		}
		pairs.push({ id: query.id, rows: now.rows });
	}

	const filters = new Set(idsOf(db, "SELECT filter_id FROM filter"));
	const deletedFilters = before.filters.filter((id) => !filters.has(id));
	if (!sameIds(deletedFilters, before.clauselessFilters)) {
		problems.push(
			`V2 filters deleted: expected ${before.clauselessFilters.join(", ") || "none"}, deleted ${deletedFilters.join(", ") || "none"}`,
		);
	}

	if (after.has("filter_anchor")) problems.push("V4 filter_anchor remains");
	if (after.get("filter")?.includes("has_anchor")) {
		problems.push("V4 filter.has_anchor remains");
	}

	const deleted = new Set(idsOf(db, DELETED_THREADS_SQL));
	const wasDeleted = new Set(before.deletedThreads);
	const cleared = before.deletedThreads.filter((id) => !deleted.has(id));
	const marked = [...deleted].filter((id) => !wasDeleted.has(id));
	if (!sameIds(cleared, before.hiddenThreads) || marked.length > 0) {
		problems.push(
			`V8 is_deleted: expected ${before.hiddenThreads.length} rows cleared and none set, found ${cleared.length} cleared and ${marked.length} set`,
		);
	}

	const clauseless = idsOf(
		db,
		"SELECT filter_id FROM filter WHERE literal_clauses = '[]' ORDER BY 1",
	);
	for (const id of clauseless) {
		problems.push(`Filter ${id} has no rules and would match every message`);
	}

	const orphans = db.prepare("PRAGMA foreign_key_check").all() as Array<{
		table: string;
	}>;
	if (orphans.length > 0) {
		problems.push(
			`${fileName} refers to rows it does not hold, in ${[
				...new Set(orphans.map((orphan) => orphan.table)),
			].join(", ")}`,
		);
	}

	if (problems.length > 0) {
		throw new Error(
			`${fileName} did not migrate cleanly: ${problems.join("; ")}. Restore the pre-update snapshot.`,
		);
	}
	return { pairs, deletedFilters };
};
