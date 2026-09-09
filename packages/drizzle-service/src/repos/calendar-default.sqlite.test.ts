import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { provisionDefaultCalendar } from "@remit/calendar-service";
import type { ICalendarUnitOfWork } from "@remit/data-ports";
import type { Db } from "../db.js";
import {
	calendarEventIndexTable,
	calendarObjectTable,
	calendarTable,
} from "../schema.js";
import { createSqliteTestDb } from "../test-db-sqlite.js";
import { CalendarCollectionRepo } from "./calendar-collection.js";
import { DrizzleCalendarUnitOfWork } from "./calendar-unit-of-work.js";

const ACCOUNT_CONFIG_ID = "account-config-default";

describe("provisioning the default calendar", () => {
	let db: Db<Record<string, unknown>>;
	let close: () => Promise<void>;
	let unitOfWork: ICalendarUnitOfWork;

	before(async () => {
		const created = await createSqliteTestDb({
			calendars: calendarTable,
			calendarObjects: calendarObjectTable,
			calendarEventIndexes: calendarEventIndexTable,
		});
		db = created.db as unknown as Db<Record<string, unknown>>;
		close = created.close;
		unitOfWork = new DrizzleCalendarUnitOfWork(db);
	});

	after(() => close());

	test("leaves one calendar behind when several first reads arrive together", async () => {
		const provisioned = await Promise.all(
			Array.from({ length: 8 }, () =>
				provisionDefaultCalendar(unitOfWork, ACCOUNT_CONFIG_ID),
			),
		);

		const ids = new Set(provisioned.map((collection) => collection.calendarId));
		assert.equal(ids.size, 1, "every caller was handed the same calendar");

		const rows = await new CalendarCollectionRepo(db).listByAccountConfig(
			ACCOUNT_CONFIG_ID,
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.urlSegment, "default");
		assert.equal(
			rows[0]?.syncSequence,
			0,
			"a losing provision did not reset a collection the winner may already have written to",
		);
	});

	test("a later provision returns the stored collection rather than resetting it", async () => {
		const repo = new CalendarCollectionRepo(db);
		const [before] = await repo.listByAccountConfig(ACCOUNT_CONFIG_ID);
		assert.ok(before);
		await repo.bumpSyncSequence(ACCOUNT_CONFIG_ID, before.calendarId);

		const again = await provisionDefaultCalendar(
			unitOfWork,
			ACCOUNT_CONFIG_ID,
			"A different name",
		);

		assert.equal(again.calendarId, before.calendarId);
		assert.equal(again.displayName, before.displayName);
		assert.equal(again.syncSequence, 1);
	});
});
