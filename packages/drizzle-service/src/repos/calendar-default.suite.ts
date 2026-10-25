import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { provisionDefaultCalendar } from "@remit/calendar-service";
import type { ICalendarStore } from "@remit/data-ports";
import type { RepositoryDb } from "../db.js";
import { composeSqliteRepositories } from "../sqlite-repositories.js";
import type { OpenTestStores } from "../test-stores.js";
import { CalendarCollectionRepo } from "./calendar-collection.js";

const ACCOUNT_CONFIG_ID = "account-config-default";

export const calendarDefaultSuite = (open: OpenTestStores): void => {
	describe("provisioning the default calendar", () => {
		let db: RepositoryDb<Record<string, unknown>>;
		let close: () => Promise<void>;
		let store: ICalendarStore;

		before(async () => {
			const opened = await open();
			db = opened.stores.app.db;
			close = opened.close;
			store = composeSqliteRepositories(opened.stores).calendarStore;
		});

		after(() => close());

		test("leaves one calendar behind when several first reads arrive together", async () => {
			const provisioned = await Promise.all(
				Array.from({ length: 8 }, () =>
					provisionDefaultCalendar(store, ACCOUNT_CONFIG_ID),
				),
			);

			const ids = new Set(
				provisioned.map((collection) => collection.calendarId),
			);
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
				store,
				ACCOUNT_CONFIG_ID,
				"A different name",
			);

			assert.equal(again.calendarId, before.calendarId);
			assert.equal(again.displayName, before.displayName);
			assert.equal(again.syncSequence, 1);
		});
	});
};
