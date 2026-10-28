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
import * as appTables from "../schema-sets/app.js";
import * as mailTables from "../schema-sets/mail.js";
import { createTestDb, type TestDb } from "../test-db.js";
import { runDrizzleAccountConfigErase } from "./account-config-erase.js";

const log = { info: () => {} };

const ERASED = "cfg-erased";
const KEPT = "cfg-kept";

const ownerIdsOf = (tenant: string): Record<string, string> => ({
	account_config_id: tenant,
	account_id: `${tenant}-account`,
	mailbox_id: `${tenant}-mailbox`,
	message_id: `${tenant}-message`,
	calendar_id: `${tenant}-calendar`,
});

interface Owned {
	readonly name: string;
	readonly table: SQLiteTable;
	readonly ownerColumn: SQLiteColumn;
}

const owned: Owned[] = Object.entries({ ...appTables, ...mailTables }).flatMap(
	([name, table]) => {
		if (!(table instanceof SQLiteTable)) return [];
		const ownerKeys = Object.keys(ownerIdsOf(ERASED));
		const ownerColumn = ownerKeys
			.map((key) =>
				getTableConfig(table).columns.find((column) => column.name === key),
			)
			.find((column) => column !== undefined);
		return ownerColumn === undefined ? [] : [{ name, table, ownerColumn }];
	},
);

const fillerOf = (column: SQLiteColumn, tenant: string): unknown => {
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

const rowOf = (table: SQLiteTable, tenant: string): Record<string, unknown> => {
	const ownerIds = ownerIdsOf(tenant);
	return Object.fromEntries(
		Object.entries(getTableColumns(table)).flatMap(([key, column]) => {
			const ownerId = ownerIds[column.name];
			if (ownerId !== undefined) return [[key, ownerId]];
			if (column.notNull && !column.hasDefault)
				return [[key, fillerOf(column, tenant)]];
			return [];
		}),
	);
};

const countOf = async (
	db: TestDb,
	{ table, ownerColumn }: Owned,
	tenant: string,
): Promise<number> => {
	const ownerId = ownerIdsOf(tenant)[ownerColumn.name] ?? "";
	return (await db.select().from(table).where(eq(ownerColumn, ownerId))).length;
};

describe("runDrizzleAccountConfigErase", () => {
	let db: TestDb;
	let close: () => Promise<void>;

	before(async () => {
		({ db, close } = await createTestDb());
		for (const tenant of [ERASED, KEPT]) {
			for (const { table } of owned) {
				await db.insert(table).values(rowOf(table, tenant) as never);
			}
		}
		const stores = syncStores(
			{ app: db, mail: db, search: db } as never,
			BETTER_SQLITE3_LIMITS,
		);
		await runDrizzleAccountConfigErase(stores, ERASED, log);
	});

	after(async () => {
		await close();
	});

	test("leaves no row of the erased account config in any table it owns", async () => {
		for (const entry of owned) {
			const expected = entry.table === appTables.accountConfigs ? 1 : 0;
			assert.equal(
				await countOf(db, entry, ERASED),
				expected,
				`${entry.name} keeps rows of the erased account config`,
			);
		}
	});

	test("keeps every row of another account config", async () => {
		for (const entry of owned) {
			assert.equal(
				await countOf(db, entry, KEPT),
				1,
				`${entry.name} lost rows of another account config`,
			);
		}
	});
});
