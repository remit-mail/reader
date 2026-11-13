import assert from "node:assert/strict";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	migrateSqlite,
	openTestSqlite,
	type SqliteHandle,
} from "@remit/drizzle-service/sqlite";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import {
	LEGACY_SETS,
	migrateSqliteFiles,
	openFile,
	prepareInPlace,
} from "./in-place.js";
import {
	ADDED_COLUMNS,
	captureBefore,
	DROPPED_COLUMNS,
	DROPPED_TABLES,
	FILLED_COLUMNS,
	firstValue,
	isDerivedTable,
	verifyAfter,
} from "./in-place-verify.js";
import { applyMigrationSets } from "./migration-sets.js";

const ROOT = fileURLToPath(new URL("../../../deploy/vps", import.meta.url));
const fixture = (name: string): string =>
	readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

type Handle = SqliteHandle;
const quiet = (): void => {};

const dir = mkdtempSync(join(tmpdir(), "remit-in-place-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let files = 0;
const freshPath = (): string => join(dir, `remit-${files++}.db`);
const sameFile = (path: string) => ({ app: path, mail: path, search: path });

// The v0.9.22 journal: the vendored v0.9.27 sets hold v0.9.22's entries
// unchanged, so its rows are the entries up to v0.9.22's last one (entities
// 0039, auth 0000). meta's one entry is not vendored.
const V0922_LAST = {
	entities: 1791269620078,
	auth: 1783877844956,
	meta: 1784583099917,
};

// drizzle 0.x stamped each row with the millisecond its migration was
// generated; a 1.0 migration folder names only the second.
const legacyRow = (
	sqlite: Handle,
	table: string,
	migration: MigrationMeta,
): void => {
	sqlite.sqlite
		.prepare(`INSERT INTO "${table}" (hash, created_at) VALUES (?, ?)`)
		.run(migration.hash, migration.folderMillis + 123);
};

const journalRows = (sqlite: Handle): void => {
	const sets = [
		{ ...LEGACY_SETS[0], last: V0922_LAST.entities },
		{ ...LEGACY_SETS[1], last: V0922_LAST.auth },
	];
	for (const set of sets) {
		sqlite.exec(
			`CREATE TABLE "${set.migrationsTable}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
		);
		for (const migration of readMigrationFiles({
			migrationsFolder: join(ROOT, set.migrationsFolder),
		})) {
			if (migration.folderMillis > set.last) continue;
			legacyRow(sqlite, set.migrationsTable, migration);
		}
	}
	sqlite.exec(
		"CREATE TABLE __drizzle_migrations_meta (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
	);
	sqlite.sqlite
		.prepare(
			"INSERT INTO __drizzle_migrations_meta (hash, created_at) VALUES ('v0.9.22 meta 0000', ?)",
		)
		.run(V0922_LAST.meta);
};

/** A row with every NOT NULL column the test does not name filled in. */
const insert = (
	sqlite: Handle,
	table: string,
	values: Record<string, string | number | null>,
): void => {
	const columns = sqlite.sqlite
		.prepare(
			'SELECT name, type, "notnull" AS "notnull", dflt_value AS dflt FROM pragma_table_info(?)',
		)
		.all(table) as Array<{
		name: string;
		type: string;
		notnull: number;
		dflt: string | null;
	}>;
	const row: Record<string, string | number | null> = {};
	for (const column of columns) {
		if (column.name in values) {
			row[column.name] = values[column.name];
			continue;
		}
		if (!column.notnull || column.dflt !== null) continue;
		row[column.name] = /int|real/i.test(column.type)
			? 1_700_000_000
			: `${table}.${column.name}`;
	}
	const names = Object.keys(row);
	sqlite.sqlite
		.prepare(
			`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
		)
		.run(...names.map((name) => row[name]));
};

const RULES = '[{"field":"From","value":"support@npmjs.com"}]';

/**
 * One row per behaviour the migration has to get right, in the schema a
 * v0.9.22 install runs on: its migration sets plus the objects its migrator
 * installed beside them.
 */
const seedV0922 = (path: string): void => {
	const sqlite = openFile(path, "create");
	sqlite.exec(fixture("remit-v0.9.22.sql"));
	sqlite.exec(fixture("remit-v0.9.22-migrator-objects.sql"));
	journalRows(sqlite);
	insert(sqlite, "auth_user", { id: "user-1", email: "me@example.test" });
	insert(sqlite, "auth_session", { id: "sess-1", user_id: "user-1" });
	insert(sqlite, "auth_jwks", { id: "key-1" });
	insert(sqlite, "account_config", {
		account_config_id: "cfg-1",
		user_id: "user-1",
	});
	insert(sqlite, "account", {
		account_id: "acc-1",
		account_config_id: "cfg-1",
	});
	insert(sqlite, "label", { label_id: "lbl-1", account_config_id: "cfg-1" });
	for (const [mailbox, path, uidNext] of [
		["mbx-inbox", "INBOX", 42],
		["mbx-npm", "INBOX/Notifications/npm", 876],
		["mbx-notifications", "INBOX/Notifications", 2486],
	] as const) {
		insert(sqlite, "mailbox", {
			mailbox_id: mailbox,
			account_id: "acc-1",
			full_path: path,
			uid_validity: 7,
			uid_next: uidNext,
			last_sync_uid: uidNext - 1,
			high_water_mark_uid: uidNext - 1,
			initial_sync_completed_at: 1_700_000_000_000,
		});
	}
	insert(sqlite, "filter", {
		filter_id: "filter-rules",
		account_config_id: "cfg-1",
		name: "support@npmjs.com → npm",
		literal_clauses: RULES,
		match_operator: "Or",
		action_mailbox_id: "mbx-npm",
		action_label_id: "lbl-1",
	});
	insert(sqlite, "filter", {
		filter_id: "filter-anchor",
		account_config_id: "cfg-1",
		name: "Notifications npm",
		has_anchor: 1,
		literal_clauses: "[]",
		action_mailbox_id: "mbx-notifications",
	});
	insert(sqlite, "filter_anchor", {
		account_config_id: "cfg-1",
		filter_id: "filter-anchor",
		anchor_embedding: "[]",
		anchor_embedding_id: "unknown",
	});
	insert(sqlite, "organize_job_request", {
		organize_job_id: "job-1",
		account_config_id: "cfg-1",
		user_id: "user-1",
		state: "Complete",
		anchor_message_id: "msg-filed",
		literal_clauses: RULES,
		matched_count: 3,
	});
	const message = (
		id: string,
		status: string,
		extra: Record<string, string | number | null> = {},
	) =>
		insert(sqlite, "message", {
			message_id: id,
			mailbox_id: "mbx-inbox",
			uid: files * 100 + id.length,
			status,
			message_id_header: "",
			body_storage_key: `file:///bodies/${id}.eml`,
			...extra,
		});
	message("msg-filed", "active", {
		mailbox_id: "mbx-npm",
		moved_by_remit: 1,
		filter_move: JSON.stringify({
			filterId: "filter-rules",
			sourceMailboxId: "mbx-inbox",
			destinationMailboxId: "mbx-npm",
			decidedAt: 1_700_000_000_000,
		}),
		placement_decided_at: 1_700_000_000_000,
	});
	message("msg-moving", "moving", { original_mailbox_id: "mbx-inbox" });
	message("msg-deleting", "deleting");
	message("msg-unsynced", "active", { body_storage_key: null });
	insert(sqlite, "message_placement_move", {
		message_id: "msg-moving",
		account_id: "acc-1",
		account_config_id: "cfg-1",
		source_mailbox_id: "mbx-inbox",
		destination_mailbox_id: "mbx-notifications",
	});
	insert(sqlite, "message_flag_push", {
		message_id: "msg-filed",
		flag_name: "\\Seen",
		account_id: "acc-1",
		account_config_id: "cfg-1",
		mailbox_id: "mbx-npm",
		operation: "add",
	});
	for (const [thread, messageId, deleted] of [
		["tm-trashed", "msg-filed", 1],
		["tm-expunging", "msg-deleting", 1],
		["tm-live", "msg-moving", 0],
	] as const) {
		insert(sqlite, "thread_message", {
			thread_message_id: thread,
			message_id: messageId,
			account_config_id: "cfg-1",
			mailbox_id: "mbx-inbox",
			is_deleted: deleted,
			subject: `subject of ${thread}`,
		});
	}
	insert(sqlite, "body_part_content", { message_id: "msg-filed" });
	insert(sqlite, "calendar", {
		calendar_id: "cal-1",
		account_config_id: "cfg-1",
	});
	insert(sqlite, "calendar_suggestion", { calendar_suggestion_id: "sug-1" });
	insert(sqlite, "outbox", {
		id: "evt-1",
		message_id: "msg-filed",
		event: "index",
		payload: "{}",
	});
	sqlite.close();
};

const read = <T>(path: string, run: (sqlite: Handle) => T): T => {
	const sqlite = openFile(path, "readonly");
	try {
		return run(sqlite);
	} finally {
		sqlite.close();
	}
};

const rows = (path: string, sql: string): unknown[] =>
	read(path, (sqlite) => sqlite.sqlite.prepare(sql).all());

const objects = (path: string): string[] =>
	rows(
		path,
		"SELECT type || ' ' || name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY 1",
	).map((row) => Object.values(row as object)[0] as string);

const everyRow = (path: string): string =>
	JSON.stringify(
		read(path, (sqlite) =>
			(
				sqlite.sqlite
					.prepare(
						"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
					)
					.all()
					.map(firstValue) as string[]
			).map((table) => [
				table,
				sqlite.sqlite.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all(),
			]),
		),
	);

describe("a v0.9.22 remit.db migrated in place", () => {
	const path = freshPath();
	seedV0922(path);
	const beforeMessages = rows(
		path,
		"SELECT * FROM message ORDER BY message_id",
	);
	migrateSqliteFiles(sameFile(path), ROOT, quiet);

	test("keeps the filter with rules exactly as it was", () => {
		assert.deepEqual(
			rows(
				path,
				"SELECT filter_id, name, match_operator, literal_clauses, action_mailbox_id, action_label_id, state FROM filter",
			),
			[
				{
					filter_id: "filter-rules",
					name: "support@npmjs.com → npm",
					match_operator: "Or",
					literal_clauses: RULES,
					action_mailbox_id: "mbx-npm",
					action_label_id: "lbl-1",
					state: "Active",
				},
			],
		);
	});

	test("deletes the clause-less filter that would match every message, and its anchor", () => {
		assert.ok(!objects(path).includes("table filter_anchor"));
		assert.deepEqual(
			rows(
				path,
				"SELECT name FROM pragma_table_info('filter') WHERE name = 'has_anchor'",
			),
			[],
		);
	});

	test("leaves placement state and pending mutations where they were", () => {
		const after = rows(
			path,
			"SELECT * FROM message ORDER BY message_id",
		) as Array<Record<string, unknown>>;
		assert.deepEqual(
			after,
			(beforeMessages as Array<Record<string, unknown>>).map(
				({ message_id_header: _, authenticity_verdict: __, ...kept }) => ({
					...kept,
					classifier_scores: "[]",
					spam_verdict: JSON.stringify({ state: "NotChecked" }),
					spam_cleared: 0,
				}),
			),
		);
		assert.equal(rows(path, "SELECT * FROM message_placement_move").length, 1);
		assert.equal(rows(path, "SELECT * FROM message_flag_push").length, 1);
	});

	test("shows mail trashed through reader as deleted no longer, and keeps mail being expunged", () => {
		assert.deepEqual(
			rows(
				path,
				"SELECT thread_message_id, is_deleted FROM thread_message ORDER BY 1",
			),
			[
				{ thread_message_id: "tm-expunging", is_deleted: 1 },
				{ thread_message_id: "tm-live", is_deleted: 0 },
				{ thread_message_id: "tm-trashed", is_deleted: 0 },
			],
		);
	});

	test("drops the v0.9 search triggers, which would write into the new index", () => {
		const held = objects(path);
		for (const suffix of ["ai", "ad", "au"]) {
			assert.ok(!held.includes(`trigger thread_message_fts_${suffix}`));
		}
		assert.deepEqual(
			rows(
				path,
				"SELECT name FROM pragma_table_info('thread_message_fts') WHERE name = 'thread_message_id'",
			),
			[{ name: "thread_message_id" }],
		);
	});

	test("records each v0.10 set as applied, baselines included", () => {
		for (const [table, folder] of [
			["__drizzle_migrations_app", "app"],
			["__drizzle_migrations_mail", "mail"],
			["__drizzle_migrations_mcp", "mcp"],
			["__drizzle_migrations_search", "search"],
		]) {
			assert.equal(
				rows(path, `SELECT * FROM ${table}`).length,
				readMigrationFiles({
					migrationsFolder: join(ROOT, "migrations-sqlite", folder),
				}).length,
				table,
			);
		}
	});

	test("changes nothing on a second run", () => {
		const once = everyRow(path);
		migrateSqliteFiles(sameFile(path), ROOT, quiet);
		assert.equal(everyRow(path), once);
	});
});

describe("the verification", () => {
	test("fails when a carried row differs after migrating", () => {
		const path = freshPath();
		seedV0922(path);
		const sqlite = openFile(path, "create");
		try {
			const before = captureBefore(sqlite.sqlite);
			sqlite.exec(
				"UPDATE message SET mailbox_id = 'mbx-notifications' WHERE message_id = 'msg-filed'",
			);
			assert.throws(
				() => verifyAfter(sqlite.sqlite, before, "remit.db"),
				/V5 messages: 4 rows before and 4 after, and they differ/,
			);
		} finally {
			sqlite.close();
		}
	});
});

describe("refusing a file it cannot migrate safely", () => {
	const refuses = (
		change: (sqlite: Handle) => void,
		message: RegExp,
		seed: (path: string) => void = seedV0922,
	): void => {
		const path = freshPath();
		seed(path);
		const sqlite = openFile(path, "create");
		change(sqlite);
		sqlite.close();
		const bytes = readFileSync(path);
		assert.throws(
			() => migrateSqliteFiles(sameFile(path), ROOT, quiet),
			message,
		);
		assert.ok(readFileSync(path).equals(bytes), "the file changed");
	};

	test("E1: written by a release it does not know", () =>
		refuses(
			(sqlite) =>
				sqlite.exec(
					"INSERT INTO __drizzle_migrations_entities (hash, created_at) VALUES ('later', 1899999999999)",
				),
			/remit-\d+\.db was written by a release this migrator does not know \(entities migration 1899999999999\)\. Nothing was changed\./,
		));

	test("E2: tables with no migration history", () =>
		refuses(
			() => {},
			/holds tables but no migration history, so its shape is unknown\. Nothing was changed\./,
			(path) => {
				const sqlite = openFile(path, "create");
				sqlite.exec(fixture("remit-v0.9.22.sql"));
				sqlite.close();
			},
		));

	test("E3: a filter matching by example and by rules", () =>
		refuses(
			(sqlite) =>
				sqlite.exec(
					"UPDATE filter SET has_anchor = 1 WHERE filter_id = 'filter-rules'",
				),
			/Filter "support@npmjs\.com → npm" \(filter-rules\) matches by an example message and by rules\..*Nothing was changed\./,
		));

	test("E5: an organize job that has not finished", () =>
		refuses(
			(sqlite) =>
				sqlite.exec("UPDATE organize_job_request SET state = 'Running'"),
			/Organize job job-1 has not finished\..*Nothing was changed\./,
		));

	test("E6: a Message-ID held only in message.message_id_header", () =>
		refuses(
			(sqlite) =>
				sqlite.exec(
					"UPDATE message SET message_id_header = '<a@example.test>' WHERE message_id = 'msg-filed'",
				),
			/1 messages carry a Message-ID only in message\.message_id_header, which this update drops\. Nothing was changed\./,
		));

	test("E7: a body held only in body_part_content", () =>
		refuses(
			(sqlite) =>
				sqlite.exec(
					"UPDATE message SET body_storage_key = NULL WHERE message_id = 'msg-filed'",
				),
			/1 message bodies exist only in body_part_content, which this update drops\. Nothing was changed\./,
		));

	test("E8: rows in body_part_storage", () =>
		refuses(
			(sqlite) =>
				insert(sqlite, "body_part_storage", { body_part_storage_id: "bps-1" }),
			/body_part_storage holds 1 rows, which this update drops\. Nothing was changed\./,
		));
});

describe("a fresh install on one file", () => {
	test("holds the same schema as the three sets on three files", () => {
		const one = freshPath();
		migrateSqliteFiles(sameFile(one), ROOT, quiet);
		const three = { app: freshPath(), mail: freshPath(), search: freshPath() };
		migrateSqliteFiles(three, ROOT, quiet);
		const union = [
			...new Set([
				...objects(three.app),
				...objects(three.mail),
				...objects(three.search),
			]),
		].sort();
		assert.deepEqual(objects(one), union);
	});
});

/**
 * The delta between the schema a v0.9.22 file holds and the one the v0.10 sets
 * create, as the spec lists it. The verification's DROPPED_* and ADDED_*
 * maps are the rows that touch existing data; the rest are new tables, which
 * the migration creates empty, and legacy tables it keeps but nothing reads.
 */
const NEW_TABLES: ReadonlyMap<string, string> = new Map([
	["body_structure_refetch", "entities 0041"],
	["sync_warning", "entities 0042"],
	["calendar_task", "app 0001"],
	["identity_audit_event", "app 0002"],
	["identity_step_up", "app 0002"],
	["message_search_text", "mail 0001"],
	["outbox_scheduling_part", "mail 0006"],
	["label_mailbox", "mail 0011"],
	["domain_registration", "mail 0014"],
	["mcp_jwks", "mcp 0000"],
	["mcp_oauth_access_token", "mcp 0000"],
	["mcp_oauth_client", "mcp 0000"],
	["mcp_oauth_client_assertion", "mcp 0000"],
	["mcp_oauth_client_resource", "mcp 0000"],
	["mcp_oauth_consent", "mcp 0000"],
	["mcp_oauth_refresh_token", "mcp 0000"],
	["mcp_oauth_resource", "mcp 0000"],
	["mcp_session", "mcp 0000"],
	["mcp_verification", "mcp 0000"],
	["mcp_device_code", "mcp 0001"],
	["mcp_account", "mcp 0004"],
	["mcp_user", "mcp 0004"],
]);
const KEPT_UNREAD = new Set(["instance_owner"]);

const shape = (sqlite: Handle): Map<string, string[]> =>
	new Map(
		(
			sqlite.sqlite
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map(firstValue) as string[]
		)
			.filter((table) => !isDerivedTable(table))
			.map((table) => [
				table,
				sqlite.sqlite
					.prepare("SELECT name FROM pragma_table_info(?)")
					.all(table)
					.map(firstValue) as string[],
			]),
	);

describe("the spec's delta table", () => {
	test("names every table and column the v0.9.22 and v0.10 schemas differ in", () => {
		const old = openTestSqlite();
		old.exec(fixture("remit-v0.9.22.sql"));
		const fresh = openTestSqlite();
		applyMigrationSets(
			{
				app: fresh,
				mail: fresh,
				search: fresh,
			},
			ROOT,
			quiet,
		);
		const was = shape(old);
		const now = shape(fresh);
		old.close();
		fresh.close();

		const found: string[] = [];
		for (const [table, columns] of was) {
			const kept = now.get(table);
			if (!kept) {
				found.push(`dropped table ${table}`);
				continue;
			}
			for (const column of columns) {
				if (!kept.includes(column))
					found.push(`dropped column ${table}.${column}`);
			}
			for (const column of kept) {
				if (!columns.includes(column))
					found.push(`added column ${table}.${column}`);
			}
		}
		for (const table of now.keys()) {
			if (!was.has(table)) found.push(`added table ${table}`);
		}

		const listed = [
			...[...DROPPED_TABLES.keys(), ...KEPT_UNREAD].map(
				(table) => `dropped table ${table}`,
			),
			...[...DROPPED_COLUMNS.keys()].map(
				(column) => `dropped column ${column}`,
			),
			...[...ADDED_COLUMNS.keys(), ...FILLED_COLUMNS.keys()].map(
				(column) => `added column ${column}`,
			),
			...[...NEW_TABLES.keys()].map((table) => `added table ${table}`),
		];
		assert.deepEqual(found.sort(), listed.sort());
	});

	test("applies only the legacy tail to a v0.9.22 file: entities 0040 to 0044 and auth 0001", () => {
		const sqlite = openTestSqlite();
		sqlite.exec(fixture("remit-v0.9.22.sql"));
		journalRows(sqlite);
		for (const set of LEGACY_SETS) {
			migrateSqlite(sqlite, {
				migrationsFolder: join(ROOT, set.migrationsFolder),
				migrationsTable: set.migrationsTable,
			});
		}
		const applied = (table: string): number =>
			firstValue(
				sqlite.sqlite
					.prepare(`SELECT count(*) FROM ${table} WHERE applied_at IS NOT NULL`)
					.get(),
			) as number;
		assert.equal(applied("__drizzle_migrations_entities"), 5);
		assert.equal(applied("__drizzle_migrations_auth"), 1);
		sqlite.close();
	});
});

/**
 * What v0.9.27 left: the v0.9.22 file with the entities tail to 0044, auth
 * 0001 and the mcp set to 0001 applied by its own migrator.
 */
const seedV0927 = (path: string): void => {
	seedV0922(path);
	const sqlite = openFile(path, "create");
	const legacyLast = [V0922_LAST.entities, V0922_LAST.auth];
	LEGACY_SETS.forEach((set, index) => {
		for (const migration of readMigrationFiles({
			migrationsFolder: join(ROOT, set.migrationsFolder),
		})) {
			if (migration.folderMillis <= legacyLast[index]) continue;
			for (const statement of migration.sql) {
				if (statement.trim()) sqlite.exec(statement);
			}
			legacyRow(sqlite, set.migrationsTable, migration);
		}
	});
	sqlite.exec(
		"CREATE TABLE __drizzle_migrations_mcp (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
	);
	for (const migration of readMigrationFiles({
		migrationsFolder: join(ROOT, "migrations-sqlite", "mcp"),
	}).slice(0, 2)) {
		for (const statement of migration.sql) {
			if (statement.trim()) sqlite.exec(statement);
		}
		legacyRow(sqlite, "__drizzle_migrations_mcp", migration);
	}
	sqlite.close();
};

describe("a v0.9.27 remit.db migrated in place", () => {
	const path = freshPath();
	seedV0927(path);
	const newest = read(path, (sqlite) =>
		firstValue(
			sqlite.sqlite
				.prepare("SELECT max(created_at) FROM __drizzle_migrations_entities")
				.get(),
		),
	);
	migrateSqliteFiles(sameFile(path), ROOT, quiet);

	test("starts from the entities journal at 0044", () => {
		const [last] = readMigrationFiles({
			migrationsFolder: join(ROOT, LEGACY_SETS[0].migrationsFolder),
		}).slice(-1);
		assert.equal(Number(newest), last.folderMillis + 123);
	});

	test("keeps the filter with rules and the pending mutations", () => {
		assert.deepEqual(rows(path, "SELECT filter_id FROM filter"), [
			{ filter_id: "filter-rules" },
		]);
		assert.equal(rows(path, "SELECT * FROM message_placement_move").length, 1);
		assert.equal(rows(path, "SELECT * FROM message_flag_push").length, 1);
	});

	test("applies the later mcp migrations on top of the 0001 it already held", () => {
		assert.equal(
			rows(path, "SELECT * FROM __drizzle_migrations_mcp").length,
			5,
		);
	});
});

describe("a run that stopped before verifying", () => {
	test("is refused on the next run instead of reported migrated", () => {
		const path = freshPath();
		seedV0922(path);
		assert.ok(prepareInPlace(sameFile(path), ROOT, quiet));
		assert.throws(
			() => migrateSqliteFiles(sameFile(path), ROOT, quiet),
			/was migrated in place by a run that did not finish its verification.*Restore the pre-update snapshot/,
		);
	});
});

describe("a volume a v0.9.28 to v0.10 release split", () => {
	test("is refused rather than migrated as an empty install", () => {
		const volume = join(dir, "split-volume");
		mkdirSync(volume);
		const seeded = freshPath();
		seedV0922(seeded);
		copyFileSync(seeded, join(volume, "remit.db.pre-split"));
		writeFileSync(join(volume, "app.db"), "the split app database");
		const path = join(volume, "remit.db");
		assert.throws(
			() => migrateSqliteFiles(sameFile(path), ROOT, quiet),
			/remit\.db is missing or empty, but app\.db, remit\.db\.pre-split beside it hold the data of a release that split remit\.db\..*Nothing was changed\./,
		);
		assert.ok(!existsSync(path), "an empty remit.db was created");
	});
});
