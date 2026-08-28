import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ICalendarEventIndexRepository } from "../interfaces/calendar-event-index.js";
import type { CalendarOccurrenceInput } from "../types.js";
import type { RepositoryConformanceHarness } from "./harness.js";

const occurrence = (
	recurrenceId: string,
	startAt: string,
	endAt: string,
): CalendarOccurrenceInput => ({
	recurrenceId,
	startAt,
	endAt,
	allDay: false,
});

export function calendarEventIndexRepositoryConformance(
	harness: RepositoryConformanceHarness<ICalendarEventIndexRepository>,
): void {
	describe("ICalendarEventIndexRepository conformance", () => {
		let repo: ICalendarEventIndexRepository;

		before(async () => {
			repo = await harness.createRepository();
		});

		after(() => harness.teardown());

		test("replaceForObject writes the master occurrence under an empty recurrenceId", async () => {
			const calendarId = harness.makeId();
			const calendarObjectId = harness.makeId();

			await repo.replaceForObject(calendarId, calendarObjectId, [
				occurrence("", "2026-08-26T07:00:00Z", "2026-08-26T08:00:00Z"),
			]);

			const rows = await repo.listForObject(calendarId, calendarObjectId);
			assert.equal(rows.length, 1);
			assert.equal(rows[0]?.recurrenceId, "");
			assert.equal(rows[0]?.startAt, "2026-08-26T07:00:00Z");
		});

		test("replaceForObject drops the occurrences a shortened series no longer has", async () => {
			const calendarId = harness.makeId();
			const calendarObjectId = harness.makeId();

			await repo.replaceForObject(calendarId, calendarObjectId, [
				occurrence(
					"2026-08-26T07:00:00Z",
					"2026-08-26T07:00:00Z",
					"2026-08-26T08:00:00Z",
				),
				occurrence(
					"2026-09-02T07:00:00Z",
					"2026-09-02T07:00:00Z",
					"2026-09-02T08:00:00Z",
				),
			]);
			await repo.replaceForObject(calendarId, calendarObjectId, [
				occurrence(
					"2026-08-26T07:00:00Z",
					"2026-08-26T07:00:00Z",
					"2026-08-26T08:00:00Z",
				),
			]);

			const rows = await repo.listForObject(calendarId, calendarObjectId);
			assert.deepEqual(
				rows.map((row) => row.recurrenceId),
				["2026-08-26T07:00:00Z"],
			);
		});

		test("replaceForObject leaves the other resources of the collection alone", async () => {
			const calendarId = harness.makeId();
			const mine = harness.makeId();
			const other = harness.makeId();

			await repo.replaceForObject(calendarId, other, [
				occurrence("", "2026-08-26T07:00:00Z", "2026-08-26T08:00:00Z"),
			]);
			await repo.replaceForObject(calendarId, mine, []);

			assert.equal((await repo.listForObject(calendarId, other)).length, 1);
			assert.equal((await repo.listForObject(calendarId, mine)).length, 0);
		});

		test("listByStartRange returns occurrences in start order, half-open on the end", async () => {
			const calendarId = harness.makeId();
			const calendarObjectId = harness.makeId();

			await repo.replaceForObject(calendarId, calendarObjectId, [
				occurrence(
					"2026-09-02T07:00:00Z",
					"2026-09-02T07:00:00Z",
					"2026-09-02T08:00:00Z",
				),
				occurrence(
					"2026-08-26T07:00:00Z",
					"2026-08-26T07:00:00Z",
					"2026-08-26T08:00:00Z",
				),
				occurrence(
					"2026-09-09T07:00:00Z",
					"2026-09-09T07:00:00Z",
					"2026-09-09T08:00:00Z",
				),
			]);

			const rows = await repo.listByStartRange(
				calendarId,
				"2026-08-26T07:00:00Z",
				"2026-09-09T07:00:00Z",
			);

			assert.deepEqual(
				rows.map((row) => row.startAt),
				["2026-08-26T07:00:00Z", "2026-09-02T07:00:00Z"],
			);
		});

		test("listByStartRange scopes to the collection", async () => {
			const calendarId = harness.makeId();
			const other = harness.makeId();

			await repo.replaceForObject(calendarId, harness.makeId(), [
				occurrence("", "2026-08-26T07:00:00Z", "2026-08-26T08:00:00Z"),
			]);
			await repo.replaceForObject(other, harness.makeId(), [
				occurrence("", "2026-08-26T07:00:00Z", "2026-08-26T08:00:00Z"),
			]);

			const rows = await repo.listByStartRange(
				calendarId,
				"2026-08-01T00:00:00Z",
				"2026-09-01T00:00:00Z",
			);
			assert.equal(rows.length, 1);
		});

		test("deleteForObject removes every occurrence of one resource", async () => {
			const calendarId = harness.makeId();
			const calendarObjectId = harness.makeId();

			await repo.replaceForObject(calendarId, calendarObjectId, [
				occurrence("", "2026-08-26T07:00:00Z", "2026-08-26T08:00:00Z"),
			]);
			await repo.deleteForObject(calendarId, calendarObjectId);

			assert.equal(
				(await repo.listForObject(calendarId, calendarObjectId)).length,
				0,
			);
		});
	});
}
