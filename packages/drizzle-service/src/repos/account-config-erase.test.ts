import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, getTableColumns } from "drizzle-orm";
import {
	getTableConfig,
	type SQLiteColumn,
	SQLiteTable,
} from "drizzle-orm/sqlite-core";
import { BETTER_SQLITE3_LIMITS } from "../bound-parameters.js";
import { syncStores } from "../databases.js";
import {
	bodyPartTable,
	calendarEventIndexTable,
	calendarObjectTable,
	mailboxFlagTable,
	mailboxTable,
	messageTable,
} from "../schema.js";
import * as appTables from "../schema-sets/app.js";
import * as mailTables from "../schema-sets/mail.js";
import { createTestDb, type TestDb } from "../test-db.js";
import { runDrizzleAccountConfigErase } from "./account-config-erase.js";

const log = { info: () => {} };

const ERASED = "cfg-erased";
const KEPT = "cfg-kept";

interface KeyedTable {
	readonly name: string;
	readonly table: SQLiteTable;
	readonly accountConfigColumn: SQLiteColumn;
}

const keyedTables: KeyedTable[] = Object.entries({
	...appTables,
	...mailTables,
}).flatMap(([name, table]) => {
	if (!(table instanceof SQLiteTable)) return [];
	const accountConfigColumn = getTableConfig(table).columns.find(
		(column) => column.name === "account_config_id",
	);
	return accountConfigColumn === undefined
		? []
		: [{ name, table, accountConfigColumn }];
});

const fillerOf = (column: SQLiteColumn, tenant: string): unknown => {
	if (column.name === "account_config_id") return tenant;
	switch (column.dataType) {
		case "number":
			return 1;
		case "boolean":
			return false;
		case "json":
			return {};
		case "buffer":
			return Buffer.from(tenant);
		default:
			return `${tenant}-${column.name}`;
	}
};

const rowOf = (
	table: SQLiteTable,
	tenant: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
	...Object.fromEntries(
		Object.entries(getTableColumns(table))
			.filter(([, column]) => column.notNull && !column.hasDefault)
			.map(([key, column]) => [key, fillerOf(column, tenant)]),
	),
	...overrides,
});

const countOf = async (
	db: TestDb,
	table: SQLiteTable,
	column: SQLiteColumn,
	value: string,
): Promise<number> =>
	(await db.select().from(table).where(eq(column, value))).length;

describe("runDrizzleAccountConfigErase", () => {
	let db: TestDb;
	let close: () => Promise<void>;

	before(async () => {
		({ db, close } = await createTestDb());
		for (const tenant of [ERASED, KEPT]) {
			for (const { table } of keyedTables) {
				await db.insert(table).values(rowOf(table, tenant) as never);
			}
			await db.insert(appTables.accounts).values(
				rowOf(appTables.accounts, tenant, {
					accountId: `${tenant}-account`,
				}) as never,
			);
			await db.insert(mailboxTable).values(
				rowOf(mailboxTable, tenant, {
					mailboxId: `${tenant}-mailbox`,
					accountId: `${tenant}-account`,
				}) as never,
			);
			await db.insert(mailboxFlagTable).values(
				rowOf(mailboxFlagTable, tenant, {
					mailboxId: `${tenant}-mailbox`,
				}) as never,
			);
			await db.insert(messageTable).values(
				rowOf(messageTable, tenant, {
					messageId: `${tenant}-message`,
					mailboxId: `${tenant}-mailbox`,
				}) as never,
			);
			await db.insert(bodyPartTable).values(
				rowOf(bodyPartTable, tenant, {
					messageId: `${tenant}-message`,
				}) as never,
			);
			await db.insert(appTables.calendarCollections).values(
				rowOf(appTables.calendarCollections, tenant, {
					calendarId: `${tenant}-calendar`,
				}) as never,
			);
			await db.insert(calendarObjectTable).values(
				rowOf(calendarObjectTable, tenant, {
					calendarObjectId: `${tenant}-object`,
					calendarId: `${tenant}-calendar`,
				}) as never,
			);
			await db.insert(calendarEventIndexTable).values(
				rowOf(calendarEventIndexTable, tenant, {
					calendarId: `${tenant}-calendar`,
					calendarObjectId: `${tenant}-object`,
				}) as never,
			);
		}

		await runDrizzleAccountConfigErase(
			syncStores(
				{ app: db, mail: db, search: db } as never,
				BETTER_SQLITE3_LIMITS,
			),
			ERASED,
			log,
		);
	});

	after(async () => {
		await close();
	});

	test("leaves no row of the erased account config in any table keyed by it", async () => {
		for (const { name, table, accountConfigColumn } of keyedTables) {
			const expected = table === appTables.accountConfigs ? 1 : 0;
			assert.equal(
				await countOf(db, table, accountConfigColumn, ERASED),
				expected,
				`${name} keeps rows of the erased account config`,
			);
		}
	});

	test("deletes the rows reached through its accounts, mailboxes, messages and calendars", async () => {
		const reached: [SQLiteTable, SQLiteColumn, string][] = [
			[mailboxTable, mailboxTable.accountId, `${ERASED}-account`],
			[mailboxFlagTable, mailboxFlagTable.mailboxId, `${ERASED}-mailbox`],
			[messageTable, messageTable.mailboxId, `${ERASED}-mailbox`],
			[bodyPartTable, bodyPartTable.messageId, `${ERASED}-message`],
			[
				calendarObjectTable,
				calendarObjectTable.calendarId,
				`${ERASED}-calendar`,
			],
			[
				calendarEventIndexTable,
				calendarEventIndexTable.calendarId,
				`${ERASED}-calendar`,
			],
		];
		for (const [table, column, value] of reached) {
			assert.equal(
				await countOf(db, table, column, value),
				0,
				`${getTableConfig(table).name} keeps ${value}`,
			);
		}
	});

	test("keeps every row of another account config", async () => {
		for (const { name, table, accountConfigColumn } of keyedTables) {
			assert.ok(
				(await countOf(db, table, accountConfigColumn, KEPT)) > 0,
				`${name} lost rows of another account config`,
			);
		}
		assert.equal(
			await countOf(
				db,
				messageTable,
				messageTable.mailboxId,
				`${KEPT}-mailbox`,
			),
			1,
		);
	});
});
