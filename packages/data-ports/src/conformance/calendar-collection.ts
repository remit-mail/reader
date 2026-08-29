import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { CalendarColor, CalendarSource } from "@remit/domain-enums";
import { deriveCalendarId } from "../id.js";

import type { ICalendarCollectionRepository } from "../interfaces/calendar-collection.js";
import type { RepositoryConformanceHarness } from "./harness.js";

export function calendarCollectionRepositoryConformance(
	harness: RepositoryConformanceHarness<ICalendarCollectionRepository>,
): void {
	describe("ICalendarCollectionRepository conformance", () => {
		let repo: ICalendarCollectionRepository;

		before(async () => {
			repo = await harness.createRepository();
		});

		after(() => harness.teardown());

		test("create derives calendarId from the account config and the url segment", async () => {
			const accountConfigId = harness.makeId();

			const calendar = await repo.create({
				accountConfigId,
				urlSegment: "default",
				displayName: "Calendar",
			});

			assert.equal(
				calendar.calendarId,
				deriveCalendarId(accountConfigId, "default"),
			);
			assert.equal(calendar.color, CalendarColor.Cal1);
			assert.equal(calendar.source, CalendarSource.UserCreated);
			assert.equal(calendar.componentSet, "VeventOnly");
			assert.equal(calendar.timezone, "");
			assert.equal(calendar.syncSequence, 0);
		});

		test("create is idempotent, so first-use provisioning never forks a second collection", async () => {
			const accountConfigId = harness.makeId();

			const first = await repo.create({
				accountConfigId,
				urlSegment: "default",
				displayName: "Calendar",
				source: CalendarSource.Default,
			});
			const second = await repo.create({
				accountConfigId,
				urlSegment: "default",
				displayName: "Calendar",
				source: CalendarSource.Default,
			});

			assert.equal(second.calendarId, first.calendarId);
			const all = await repo.listByAccountConfig(accountConfigId);
			assert.equal(all.length, 1);
		});

		test("createExclusive refuses a segment the account already uses", async () => {
			const accountConfigId = harness.makeId();

			const first = await repo.createExclusive({
				accountConfigId,
				urlSegment: "work",
				displayName: "Work",
			});
			const second = await repo.createExclusive({
				accountConfigId,
				urlSegment: "work",
				displayName: "Work again",
			});

			assert.ok(first);
			assert.equal(second, null);
			assert.equal(
				(await repo.get(accountConfigId, first.calendarId)).displayName,
				"Work",
				"the loser never overwrote the calendar the winner made",
			);
		});

		test("get throws a not-found error for a missing collection", async () => {
			await assert.rejects(
				repo.get(harness.makeId(), harness.makeId()),
				(error) => harness.isNotFoundError(error),
			);
		});

		test("update changes the display overlay, never the key", async () => {
			const accountConfigId = harness.makeId();
			const calendar = await repo.create({
				accountConfigId,
				urlSegment: "work",
				displayName: "Work",
			});

			const updated = await repo.update(accountConfigId, calendar.calendarId, {
				displayName: "Work & Travel",
				color: CalendarColor.Cal4,
				timezone: "Europe/Amsterdam",
			});

			assert.equal(updated.calendarId, calendar.calendarId);
			assert.equal(updated.urlSegment, "work");
			assert.equal(updated.displayName, "Work & Travel");
			assert.equal(updated.color, CalendarColor.Cal4);
			assert.equal(updated.timezone, "Europe/Amsterdam");
		});

		test("update throws a not-found error for a missing collection", async () => {
			await assert.rejects(
				repo.update(harness.makeId(), harness.makeId(), {
					displayName: "x",
				}),
				(error) => harness.isNotFoundError(error),
			);
		});

		test("findByUrlSegment resolves the path segment a client bookmarked", async () => {
			const accountConfigId = harness.makeId();
			const calendar = await repo.create({
				accountConfigId,
				urlSegment: "personal",
				displayName: "Personal",
			});

			const found = await repo.findByUrlSegment(accountConfigId, "personal");
			assert.equal(found?.calendarId, calendar.calendarId);

			assert.equal(
				await repo.findByUrlSegment(accountConfigId, "nonexistent"),
				null,
			);
		});

		test("a segment stored in one casing is found in another, and by its derived id", async () => {
			// The id derivation folds case; the stored column has to fold with it,
			// or one DAV path resolves through `findByUrlSegment` and not through a
			// `get` by derived id.
			const accountConfigId = harness.makeId();

			const calendar = await repo.create({
				accountConfigId,
				urlSegment: "Work-Calendar",
				displayName: "Work",
			});

			assert.equal(calendar.urlSegment, "work-calendar");
			assert.equal(
				calendar.calendarId,
				deriveCalendarId(accountConfigId, "WORK-CALENDAR"),
			);
			assert.equal(
				(await repo.findByUrlSegment(accountConfigId, "WORK-CALENDAR"))
					?.calendarId,
				calendar.calendarId,
			);
			assert.equal(
				(await repo.get(accountConfigId, calendar.calendarId)).urlSegment,
				"work-calendar",
			);
		});

		test("listByAccountConfig scopes to the account config", async () => {
			const accountConfigId = harness.makeId();
			const other = harness.makeId();

			const mine = await repo.create({
				accountConfigId,
				urlSegment: "default",
				displayName: "Mine",
			});
			await repo.create({
				accountConfigId: other,
				urlSegment: "default",
				displayName: "Foreign",
			});

			const calendars = await repo.listByAccountConfig(accountConfigId);
			assert.equal(calendars.length, 1);
			assert.equal(calendars[0]?.calendarId, mine.calendarId);
		});

		test("bumpSyncSequence hands every caller a distinct increasing value", async () => {
			const accountConfigId = harness.makeId();
			const calendar = await repo.create({
				accountConfigId,
				urlSegment: "seq",
				displayName: "Seq",
			});

			const sequences: number[] = [];
			for (let i = 0; i < 5; i += 1) {
				sequences.push(
					await repo.bumpSyncSequence(accountConfigId, calendar.calendarId),
				);
			}

			assert.deepEqual(sequences, [1, 2, 3, 4, 5]);
			const reread = await repo.get(accountConfigId, calendar.calendarId);
			assert.equal(reread.syncSequence, 5);
		});

		test("bumpSyncSequence throws a not-found error for a missing collection", async () => {
			await assert.rejects(
				repo.bumpSyncSequence(harness.makeId(), harness.makeId()),
				(error) => harness.isNotFoundError(error),
			);
		});

		test("delete removes the row", async () => {
			const accountConfigId = harness.makeId();
			const calendar = await repo.create({
				accountConfigId,
				urlSegment: "gone",
				displayName: "Gone",
			});

			await repo.delete(accountConfigId, calendar.calendarId);

			await assert.rejects(
				repo.get(accountConfigId, calendar.calendarId),
				(error) => harness.isNotFoundError(error),
			);
		});
	});
}
