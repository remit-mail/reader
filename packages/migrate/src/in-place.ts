import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	migrateSqlite,
	openSqlite,
	openTestSqlite,
	type SqliteConnection,
	type SqliteHandle,
	type SqliteMode,
} from "@remit/drizzle-service/sqlite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { SqliteDatabasePaths } from "../../drizzle-service/src/databases.js";
import {
	type BeforeState,
	captureBefore,
	DROPPED_TABLES,
	firstValue,
	verifyAfter,
} from "./in-place-verify.js";
import { applyMigrationSets, MIGRATION_SETS } from "./migration-sets.js";

/**
 * A v0.9 install ran on one remit.db holding the app and mail tables, migrated
 * by the `entities` and `auth` sets. This brings that file to the v0.10 sets in
 * place: the v0.9.23 to v0.9.27 steps it is missing, then the app and mail
 * baselines recorded as applied once the file is shown to hold exactly their
 * shape, then the ordinary sets. Nothing is copied out of the file.
 */

type Handle = SqliteConnection;

type SqliteFile = SqliteHandle;

export const openFile = (filename: string, mode: SqliteMode): SqliteFile =>
	openSqlite({ filename, mode, synchronous: "FULL" });

export type MigrateLog = (fields: Record<string, unknown>, msg: string) => void;

/** The v0.9.27 sets, vendored verbatim; `meta` never changed after 0000. */
export const LEGACY_SETS = [
	{
		migrationsFolder: "migrations-sqlite/legacy/entities",
		migrationsTable: "__drizzle_migrations_entities",
	},
	{
		migrationsFolder: "migrations-sqlite/legacy/auth",
		migrationsTable: "__drizzle_migrations_auth",
	},
] as const;

const LEGACY_JOURNAL = LEGACY_SETS[0].migrationsTable;

/** Tables a v0.9 file holds that no v0.10 baseline creates, left in place. */
const KEPT_LEGACY_TABLES = [
	"instance_owner",
	"__drizzle_migrations_entities",
	"__drizzle_migrations_auth",
	"__drizzle_migrations_meta",
	"__drizzle_migrations_mcp",
];

/**
 * Defaults the old file keeps and the baselines omit. Every insert names both
 * columns, so the old default is never used.
 */
const KEPT_DEFAULTS = new Set([
	"account.synced_services",
	"calendar_suggestion.ends_at_utc",
]);

const setOf = (database: "app" | "mail") => {
	const set = MIGRATION_SETS.find(
		(candidate) =>
			candidate.database === database &&
			candidate.migrationsTable === `__drizzle_migrations_${database}`,
	);
	if (!set) throw new Error(`no ${database} migration set`);
	return set;
};

const migrationsOf = (root: string, folder: string) =>
	readMigrationFiles({ migrationsFolder: join(root, folder) });

const tablesOf = (db: Handle): Set<string> =>
	new Set(
		db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
			)
			.all()
			.map(firstValue) as string[],
	);

const hasColumn = (db: Handle, table: string, column: string): boolean =>
	db
		.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?")
		.get(table, column) !== undefined;

const count = (db: Handle, sql: string): number =>
	firstValue(db.prepare(sql).get()) as number;

const applyStatements = (
	db: SqliteFile,
	statements: readonly string[],
): void => {
	for (const statement of statements) {
		if (statement.trim()) db.exec(statement);
	}
};

/** The tables the first migration of a set creates, on an empty database. */
const baselineTables = (
	root: string,
	database: "app" | "mail",
): Set<string> => {
	const memory = openTestSqlite();
	try {
		const [baseline] = migrationsOf(root, setOf(database).migrationsFolder);
		applyStatements(memory, baseline.sql);
		return tablesOf(memory.sqlite);
	} finally {
		memory.close();
	}
};

const readTables = (path: string): Set<string> => {
	const db = openFile(path, "readonly");
	try {
		return tablesOf(db.sqlite);
	} finally {
		db.close();
	}
};

const nothingChanged = "Nothing was changed.";

/**
 * E2: a file holding a function's tables with no record of how they got there
 * cannot be migrated forward safely.
 */
const refuseUnknownHistory = (
	root: string,
	paths: SqliteDatabasePaths,
	tables: ReadonlyMap<string, Set<string>>,
): void => {
	for (const database of ["app", "mail"] as const) {
		const held = tables.get(paths[database]);
		if (!held) continue;
		if (held.has(LEGACY_JOURNAL)) continue;
		if (held.has(`__drizzle_migrations_${database}`)) continue;
		const own = baselineTables(root, database);
		if (![...own].some((table) => held.has(table))) continue;
		throw new Error(
			`${basename(paths[database])} holds tables but no migration history, so its shape is unknown. ${nothingChanged}`,
		);
	}
};

/** E1, E3, E5-E8: read-only, before anything is written. */
const preflight = (db: Handle, root: string, fileName: string): void => {
	const known = migrationsOf(root, LEGACY_SETS[0].migrationsFolder).at(-1);
	const newest = Number(
		firstValue(
			db.prepare(`SELECT max(created_at) FROM ${LEGACY_JOURNAL}`).get(),
		),
	);
	// drizzle 0.x stamped a row to the millisecond; a migration folder names
	// only the second.
	if (known && Math.floor(newest / 1000) * 1000 > known.folderMillis) {
		throw new Error(
			`${fileName} was written by a release this migrator does not know (entities migration ${newest}). ${nothingChanged}`,
		);
	}

	if (hasColumn(db, "filter", "has_anchor")) {
		const both = db
			.prepare(
				"SELECT filter_id AS id, name FROM filter WHERE has_anchor = 1 AND literal_clauses <> '[]' ORDER BY filter_id",
			)
			.all() as Array<{ id: string; name: string }>;
		const [first] = both;
		if (first) {
			throw new Error(
				`Filter "${first.name}" (${first.id}) matches by an example message and by rules. This release has no example matching, so it would match more mail than it does now. Edit or delete it on the running release, then update again. ${nothingChanged}`,
			);
		}
	}

	const running = firstValue(
		db
			.prepare(
				"SELECT organize_job_id FROM organize_job_request WHERE state IN ('Pending','Running') ORDER BY 1",
			)
			.get(),
	) as string | undefined;
	if (running) {
		throw new Error(
			`Organize job ${running} has not finished. Let it finish on the running release, then update again. ${nothingChanged}`,
		);
	}

	if (hasColumn(db, "message", "message_id_header")) {
		const n = count(
			db,
			"SELECT count(*) FROM message WHERE message_id_header <> ''",
		);
		if (n > 0) {
			throw new Error(
				`${n} messages carry a Message-ID only in message.message_id_header, which this update drops. ${nothingChanged}`,
			);
		}
	}

	const tables = tablesOf(db);
	if (tables.has("body_part_content")) {
		const n = count(
			db,
			"SELECT count(*) FROM message m WHERE (m.body_storage_key IS NULL OR m.body_storage_key = '') AND EXISTS (SELECT 1 FROM body_part_content c WHERE c.message_id = m.message_id)",
		);
		if (n > 0) {
			throw new Error(
				`${n} message bodies exist only in body_part_content, which this update drops. ${nothingChanged}`,
			);
		}
	}
	if (tables.has("body_part_storage")) {
		const n = count(db, "SELECT count(*) FROM body_part_storage");
		if (n > 0) {
			throw new Error(
				`body_part_storage holds ${n} rows, which this update drops. ${nothingChanged}`,
			);
		}
	}
};

interface TableShape {
	columns: Map<string, string>;
	defaults: Map<string, string | null>;
	foreignKeys: string;
	indexes: Map<string, string>;
}

const normaliseSql = (sql: string | null): string =>
	(sql ?? "")
		.replace(/[`"]/g, "")
		.replace(/\s+/g, "")
		.toLowerCase()
		.replace("ifnotexists", "");

const shapeOf = (db: Handle, table: string): TableShape => {
	const columns = db
		.prepare(
			'SELECT name, type, "notnull" AS "notnull", dflt_value AS dflt, pk FROM pragma_table_info(?)',
		)
		.all(table) as Array<{
		name: string;
		type: string;
		notnull: number;
		dflt: string | null;
		pk: number;
	}>;
	const foreignKeys = (
		db
			.prepare(
				'SELECT "from" AS col, "table" AS ref, "to" AS target, on_delete AS del FROM pragma_foreign_key_list(?)',
			)
			.all(table) as Array<Record<string, string>>
	)
		.map((fk) => `${fk.col}->${fk.ref}.${fk.target} ${fk.del}`)
		.sort()
		.join(", ");
	const indexes = db
		.prepare(
			"SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
		)
		.all(table) as Array<{ name: string; sql: string | null }>;
	return {
		columns: new Map(
			columns.map((c) => [
				c.name,
				`${c.type} ${c.notnull ? "NOT NULL" : "NULL"}${c.pk ? ` pk${c.pk}` : ""}`,
			]),
		),
		defaults: new Map(columns.map((c) => [c.name, c.dflt])),
		foreignKeys,
		indexes: new Map(indexes.map((i) => [i.name, normaliseSql(i.sql)])),
	};
};

/** Every way `actual` differs from `expected`, outside the allowed list. */
export const baselineDifferences = (
	expected: Handle,
	actual: Handle,
	allowedExtraTables: ReadonlySet<string>,
): string[] => {
	const differences: string[] = [];
	const wanted = tablesOf(expected);
	const held = tablesOf(actual);
	for (const table of [...wanted].sort()) {
		if (!held.has(table)) {
			differences.push(`${table}: expected a table, found none`);
			continue;
		}
		const want = shapeOf(expected, table);
		const have = shapeOf(actual, table);
		for (const [column, shape] of want.columns) {
			const found = have.columns.get(column);
			if (found !== shape) {
				differences.push(
					`${table}.${column}: expected ${shape}, found ${found ?? "no column"}`,
				);
				continue;
			}
			const dflt = want.defaults.get(column);
			const heldDflt = have.defaults.get(column);
			if (dflt !== heldDflt && !KEPT_DEFAULTS.has(`${table}.${column}`)) {
				differences.push(
					`${table}.${column}: expected default ${dflt}, found ${heldDflt}`,
				);
			}
		}
		for (const [column, shape] of have.columns) {
			if (!want.columns.has(column)) {
				differences.push(
					`${table}.${column}: expected no column, found ${shape}`,
				);
			}
		}
		if (want.foreignKeys !== have.foreignKeys) {
			differences.push(
				`${table} foreign keys: expected ${want.foreignKeys || "none"}, found ${have.foreignKeys || "none"}`,
			);
		}
		for (const [index, sql] of want.indexes) {
			const found = have.indexes.get(index);
			if (found !== sql) {
				differences.push(
					`${index}: expected ${sql || "an automatic index"}, found ${found ?? "no index"}`,
				);
			}
		}
		for (const index of have.indexes.keys()) {
			if (!want.indexes.has(index)) {
				differences.push(`${index}: expected no index on ${table}, found one`);
			}
		}
	}
	for (const table of [...held].sort()) {
		if (wanted.has(table) || allowedExtraTables.has(table)) continue;
		differences.push(`${table}: expected no table, found one`);
	}
	return differences;
};

const JOURNAL_DDL = (table: string): string =>
	`CREATE TABLE IF NOT EXISTS "${table}" (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`;

/**
 * Step 2: the file must hold exactly what the app and mail baselines create,
 * and then their first migration is recorded as applied rather than run.
 */
const adoptBaselines = (
	db: SqliteFile,
	root: string,
	fileName: string,
): void => {
	const baselines = (["app", "mail"] as const).map((database) => {
		const set = setOf(database);
		const [first] = migrationsOf(root, set.migrationsFolder);
		return { table: set.migrationsTable, migration: first };
	});
	const mcpTables = openTestSqlite();
	const expected = openTestSqlite();
	try {
		for (const set of MIGRATION_SETS) {
			if (set.migrationsTable !== "__drizzle_migrations_mcp") continue;
			for (const migration of migrationsOf(root, set.migrationsFolder)) {
				applyStatements(mcpTables, migration.sql);
			}
		}
		for (const { migration } of baselines) {
			applyStatements(expected, migration.sql);
		}
		const differences = baselineDifferences(
			expected.sqlite,
			db.sqlite,
			new Set([...KEPT_LEGACY_TABLES, ...tablesOf(mcpTables.sqlite)]),
		);
		if (differences.length > 0) {
			throw new Error(
				`${fileName} does not match the v0.10 baseline: ${differences.join("; ")}. Restore the pre-update snapshot.`,
			);
		}
	} finally {
		mcpTables.close();
		expected.close();
	}
	db.db.transaction(() => {
		for (const { table, migration } of baselines) {
			db.exec(JOURNAL_DDL(table));
			db.sqlite
				.prepare(
					`INSERT INTO "${table}" ("hash", "created_at", "name", "applied_at") VALUES (?, ?, ?, ?)`,
				)
				.run(
					migration.hash,
					migration.folderMillis,
					migration.name,
					new Date().toISOString(),
				);
		}
	});
};

/**
 * v0.9's search index was an external-content FTS table inside remit.db, fed
 * by triggers on thread_message. The v0.10 search set creates its own table of
 * that name, and the old triggers would write into it on every thread write.
 * The index is rebuilt from the mail rows after migrating.
 */
const dropLegacySearchIndex = (db: SqliteFile): void => {
	db.db.transaction(() => {
		for (const suffix of ["ai", "ad", "au"]) {
			db.exec(`DROP TRIGGER IF EXISTS thread_message_fts_${suffix}`);
		}
		db.exec("DROP TABLE IF EXISTS thread_message_fts");
	});
};

const logRemovals = (db: Handle, log: MigrateLog): void => {
	const filters = db
		.prepare(
			"SELECT filter_id AS filterId, name FROM filter WHERE literal_clauses = '[]' ORDER BY filter_id",
		)
		.all() as Array<{ filterId: string; name: string }>;
	for (const filter of filters) {
		log(
			{ step: "in-place", ...filter },
			"deleting a filter with no rules, which would match every message",
		);
	}
	const tables = tablesOf(db);
	for (const [table, migration] of DROPPED_TABLES) {
		if (!tables.has(table)) continue;
		log(
			{
				step: "in-place",
				table,
				migration,
				rows: count(db, `SELECT count(*) FROM "${table}"`),
			},
			"dropping a table the v0.10 schema no longer has",
		);
	}
};

/** What v0.9.28 to v0.10.x left on the volume when they split remit.db. */
const SPLIT_LEFTOVERS = ["app.db", "mail.db", "remit.db.pre-split"];

const holdsBytes = (path: string): boolean =>
	existsSync(path) && statSync(path).size > 0;

/**
 * A split install renamed remit.db aside, so the configured file is missing
 * while its data sits beside it. Migrating would create an empty database and
 * the instance would come up with no accounts.
 */
const refuseSplitInstall = (paths: SqliteDatabasePaths): void => {
	for (const database of ["app", "mail"] as const) {
		const path = paths[database];
		if (holdsBytes(path)) continue;
		const configured = new Set(Object.values(paths));
		const leftovers = SPLIT_LEFTOVERS.map((name) =>
			join(dirname(path), name),
		).filter((leftover) => !configured.has(leftover) && holdsBytes(leftover));
		if (leftovers.length === 0) continue;
		throw new Error(
			`${basename(path)} is missing or empty, but ${leftovers.map((leftover) => basename(leftover)).join(", ")} beside it hold the data of a release that split remit.db. This release runs on one remit.db: put the database it should run on at ${path}, or point SQLITE_APP_DB_PATH, SQLITE_MAIL_DB_PATH and SQLITE_SEARCH_DB_PATH at the split files. ${nothingChanged}`,
		);
	}
};

/**
 * Written only once a v0.9 file has passed {@link verifyAfter}. A file that
 * holds both the v0.9 and v0.10 journals without it was migrated by a run that
 * failed, and a later run must not report it migrated.
 */
const VERIFIED_TABLE = "__remit_in_place_verified";

const markVerified = (db: SqliteFile): void => {
	db.exec(
		`CREATE TABLE IF NOT EXISTS "${VERIFIED_TABLE}" (verified_at integer NOT NULL)`,
	);
	db.sqlite
		.prepare(`INSERT INTO "${VERIFIED_TABLE}" (verified_at) VALUES (?)`)
		.run(Date.now());
};

export interface InPlaceMigration {
	verify(): void;
}

/**
 * Steps 1 and 2 for a v0.9 file, after a read-only preflight and a read of the
 * verification pairs' before half. Returns null when there is no v0.9 file to
 * bring forward. The ordinary sets run next, then {@link InPlaceMigration.verify}.
 */
export const prepareInPlace = (
	paths: SqliteDatabasePaths,
	root: string,
	log: MigrateLog,
): InPlaceMigration | null => {
	refuseSplitInstall(paths);
	const files = [...new Set([paths.app, paths.mail, paths.search])].filter(
		(path) => existsSync(path),
	);
	const tables = new Map(files.map((path) => [path, readTables(path)]));
	refuseUnknownHistory(root, paths, tables);

	const legacy = files.find((path) => tables.get(path)?.has(LEGACY_JOURNAL));
	if (!legacy) return null;
	const fileName = basename(legacy);
	if (paths.app !== legacy || paths.mail !== legacy) {
		throw new Error(
			`${fileName} holds the app and mail tables together, so SQLITE_APP_DB_PATH and SQLITE_MAIL_DB_PATH must both name ${legacy}. ${nothingChanged}`,
		);
	}
	const held = tables.get(legacy);
	if (held?.has(setOf("app").migrationsTable)) {
		if (held.has(VERIFIED_TABLE)) return null;
		throw new Error(
			`${fileName} was migrated in place by a run that did not finish its verification, so it may not hold what it held before. Restore the pre-update snapshot, then update again.`,
		);
	}

	let before: BeforeState;
	const reader = openFile(legacy, "readonly");
	try {
		preflight(reader.sqlite, root, fileName);
		before = captureBefore(reader.sqlite);
	} finally {
		reader.close();
	}

	const db = openFile(legacy, "open");
	try {
		logRemovals(db.sqlite, log);
		dropLegacySearchIndex(db);
		for (const set of LEGACY_SETS) {
			log({ database: set.migrationsTable }, "applying the v0.9 migrations");
			migrateSqlite(db, {
				migrationsFolder: join(root, set.migrationsFolder),
				migrationsTable: set.migrationsTable,
			});
		}
		adoptBaselines(db, root, fileName);
		log({ step: "in-place" }, "recorded the v0.10 baselines as applied");
	} finally {
		db.close();
	}

	return {
		verify: () => {
			const check = openFile(legacy, "readonly");
			try {
				const result = verifyAfter(check.sqlite, before, fileName);
				for (const pair of result.pairs) {
					log({ step: "in-place-verify", ...pair }, "unchanged");
				}
				log(
					{ step: "in-place-verify", deletedFilters: result.deletedFilters },
					"verified the migrated file against the one before it",
				);
			} finally {
				check.close();
			}
			const writer = openFile(legacy, "open");
			try {
				markVerified(writer);
			} finally {
				writer.close();
			}
		},
	};
};

/**
 * The whole schema step against the configured files: a v0.9 file brought
 * forward in place, every set applied, and the in-place result verified before
 * anything else writes to it.
 */
export const migrateSqliteFiles = (
	paths: SqliteDatabasePaths,
	root: string,
	log: MigrateLog,
): void => {
	const inPlace = prepareInPlace(paths, root, log);
	const handles = new Map<string, SqliteFile>();
	const open = (path: string): SqliteFile => {
		const handle = handles.get(path) ?? openFile(path, "create");
		handles.set(path, handle);
		return handle;
	};
	try {
		applyMigrationSets(
			{
				app: open(paths.app),
				mail: open(paths.mail),
				search: open(paths.search),
			},
			root,
			(database) => log({ database }, "applying schema migrations (sqlite)"),
		);
	} finally {
		for (const handle of handles.values()) handle.close();
	}
	inPlace?.verify();
};
