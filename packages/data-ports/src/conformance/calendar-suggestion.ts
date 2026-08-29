import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	CalendarInviteMethod,
	CalendarSuggestionSource,
	CalendarSuggestionState,
	ZoneCertainty,
} from "@remit/domain-enums";
import { deriveCalendarSuggestionId } from "../id.js";
import type { ICalendarSuggestionRepository } from "../interfaces/calendar-suggestion.js";
import type { PutCalendarSuggestionInput } from "../types.js";
import type { RepositoryConformanceHarness } from "./harness.js";

const suggestion = (
	accountConfigId: string,
	messageId: string,
	bodyPartId: string,
	icalUid: string,
	overrides: Partial<PutCalendarSuggestionInput> = {},
): PutCalendarSuggestionInput => ({
	accountConfigId,
	messageId,
	bodyPartId,
	icalUid,
	sequence: 0,
	method: CalendarInviteMethod.Request,
	source: CalendarSuggestionSource.IcalendarPart,
	summary: "Design review",
	dtStart: "2026-09-01T10:00:00+02:00",
	dtEnd: "2026-09-01T11:00:00+02:00",
	allDay: false,
	location: "",
	organizer: "organizer@example.test",
	zoneCertainty: ZoneCertainty.Explicit,
	icalData: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
	...overrides,
});

export function calendarSuggestionRepositoryConformance(
	harness: RepositoryConformanceHarness<ICalendarSuggestionRepository>,
): void {
	describe("ICalendarSuggestionRepository conformance", () => {
		let repo: ICalendarSuggestionRepository;

		before(async () => {
			repo = await harness.createRepository();
		});

		after(() => harness.teardown());

		test("put writes a Pending suggestion under its derived id", async () => {
			const accountConfigId = harness.makeId();
			const messageId = harness.makeId();
			const bodyPartId = harness.makeId();

			const written = await repo.put(
				suggestion(accountConfigId, messageId, bodyPartId, "uid-1"),
			);

			assert.equal(
				written.suggestionId,
				deriveCalendarSuggestionId(messageId, bodyPartId, "uid-1"),
			);
			assert.equal(written.state, CalendarSuggestionState.Pending);
			assert.equal(written.acceptedCalendarObjectId, "");
		});

		test("put re-reading the same message converges on one row", async () => {
			const accountConfigId = harness.makeId();
			const messageId = harness.makeId();
			const bodyPartId = harness.makeId();

			await repo.put(
				suggestion(accountConfigId, messageId, bodyPartId, "uid-1"),
			);
			await repo.put(
				suggestion(accountConfigId, messageId, bodyPartId, "uid-1", {
					summary: "Design review, moved",
				}),
			);

			const rows = await repo.listByMessage(accountConfigId, messageId);
			assert.equal(rows.length, 1);
			assert.equal(rows[0]?.summary, "Design review, moved");
		});

		test("put leaves an answered suggestion answered", async () => {
			// A re-sync must never walk a decision back to Pending: the user
			// already added this event to a calendar, and a producer write is not
			// allowed to un-decide that.
			const accountConfigId = harness.makeId();
			const messageId = harness.makeId();
			const bodyPartId = harness.makeId();

			const written = await repo.put(
				suggestion(accountConfigId, messageId, bodyPartId, "uid-1"),
			);
			await repo.settle(accountConfigId, written.suggestionId, {
				state: CalendarSuggestionState.Accepted,
				acceptedCalendarObjectId: "cal-object-1",
			});
			await repo.put(
				suggestion(accountConfigId, messageId, bodyPartId, "uid-1"),
			);

			const reread = await repo.get(accountConfigId, written.suggestionId);
			assert.equal(reread.state, CalendarSuggestionState.Accepted);
			assert.equal(reread.acceptedCalendarObjectId, "cal-object-1");
		});

		test("get rejects a suggestion that is not there", async () => {
			const accountConfigId = harness.makeId();
			await assert.rejects(
				() => repo.get(accountConfigId, harness.makeId()),
				(error: unknown) => harness.isNotFoundError(error),
			);
		});

		test("get scopes to the account config", async () => {
			const accountConfigId = harness.makeId();
			const written = await repo.put(
				suggestion(accountConfigId, harness.makeId(), harness.makeId(), "uid"),
			);

			await assert.rejects(
				() => repo.get(harness.makeId(), written.suggestionId),
				(error: unknown) => harness.isNotFoundError(error),
			);
		});

		test("listByMessage returns every suggestion one message produced", async () => {
			const accountConfigId = harness.makeId();
			const messageId = harness.makeId();
			const other = harness.makeId();

			await repo.put(
				suggestion(accountConfigId, messageId, harness.makeId(), "uid-a"),
			);
			await repo.put(
				suggestion(accountConfigId, messageId, harness.makeId(), "uid-b"),
			);
			await repo.put(
				suggestion(accountConfigId, other, harness.makeId(), "uid-c"),
			);

			const rows = await repo.listByMessage(accountConfigId, messageId);
			assert.deepEqual(rows.map((row) => row.icalUid).sort(), [
				"uid-a",
				"uid-b",
			]);
		});

		test("listByState returns only the state asked for", async () => {
			const accountConfigId = harness.makeId();
			const pending = await repo.put(
				suggestion(accountConfigId, harness.makeId(), harness.makeId(), "p"),
			);
			const declined = await repo.put(
				suggestion(accountConfigId, harness.makeId(), harness.makeId(), "d"),
			);
			await repo.settle(accountConfigId, declined.suggestionId, {
				state: CalendarSuggestionState.Declined,
				acceptedCalendarObjectId: "",
			});

			const page = await repo.listByState(
				accountConfigId,
				CalendarSuggestionState.Pending,
			);
			assert.deepEqual(
				page.items.map((row) => row.suggestionId),
				[pending.suggestionId],
			);
		});

		test("listByState scopes to the account config", async () => {
			const accountConfigId = harness.makeId();
			await repo.put(
				suggestion(harness.makeId(), harness.makeId(), harness.makeId(), "x"),
			);

			const page = await repo.listByState(
				accountConfigId,
				CalendarSuggestionState.Pending,
			);
			assert.equal(page.items.length, 0);
		});

		test("listByState pages, and the token resumes where the page stopped", async () => {
			const accountConfigId = harness.makeId();
			for (const uid of ["a", "b", "c"]) {
				await repo.put(
					suggestion(accountConfigId, harness.makeId(), harness.makeId(), uid),
				);
			}

			const first = await repo.listByState(
				accountConfigId,
				CalendarSuggestionState.Pending,
				{ limit: 2 },
			);
			assert.equal(first.items.length, 2);
			assert.ok(first.continuationToken);

			const second = await repo.listByState(
				accountConfigId,
				CalendarSuggestionState.Pending,
				{ limit: 2, continuationToken: first.continuationToken },
			);
			const seen = [...first.items, ...second.items].map(
				(row) => row.suggestionId,
			);
			assert.equal(new Set(seen).size, 3);
		});

		test("settle records the accepted resource", async () => {
			const accountConfigId = harness.makeId();
			const written = await repo.put(
				suggestion(accountConfigId, harness.makeId(), harness.makeId(), "uid"),
			);

			const settled = await repo.settle(accountConfigId, written.suggestionId, {
				state: CalendarSuggestionState.Accepted,
				acceptedCalendarObjectId: "cal-object-9",
			});

			assert.equal(settled.state, CalendarSuggestionState.Accepted);
			assert.equal(settled.acceptedCalendarObjectId, "cal-object-9");
		});

		test("supersedeIfPending retires a card still waiting on the user", async () => {
			const accountConfigId = harness.makeId();
			const written = await repo.put(
				suggestion(accountConfigId, harness.makeId(), harness.makeId(), "uid"),
			);

			const retired = await repo.supersedeIfPending(
				accountConfigId,
				written.suggestionId,
			);

			assert.equal(retired?.state, CalendarSuggestionState.Superseded);
		});

		test("supersedeIfPending leaves an answered card alone and says so", async () => {
			// The producer reads the pending set and writes to it in two steps. A
			// person accepting in between must keep their acceptance — and the
			// link to the event it put in their calendar.
			const accountConfigId = harness.makeId();
			const written = await repo.put(
				suggestion(accountConfigId, harness.makeId(), harness.makeId(), "uid"),
			);
			await repo.settle(accountConfigId, written.suggestionId, {
				state: CalendarSuggestionState.Accepted,
				acceptedCalendarObjectId: "cal-object-7",
			});

			const retired = await repo.supersedeIfPending(
				accountConfigId,
				written.suggestionId,
			);

			assert.equal(retired, null);
			const reread = await repo.get(accountConfigId, written.suggestionId);
			assert.equal(reread.state, CalendarSuggestionState.Accepted);
			assert.equal(reread.acceptedCalendarObjectId, "cal-object-7");
		});

		test("supersedeIfPending scopes to the account config", async () => {
			const accountConfigId = harness.makeId();
			const written = await repo.put(
				suggestion(accountConfigId, harness.makeId(), harness.makeId(), "uid"),
			);

			assert.equal(
				await repo.supersedeIfPending(harness.makeId(), written.suggestionId),
				null,
			);
		});

		test("settle rejects a suggestion that is not there", async () => {
			const accountConfigId = harness.makeId();
			await assert.rejects(
				() =>
					repo.settle(accountConfigId, harness.makeId(), {
						state: CalendarSuggestionState.Declined,
						acceptedCalendarObjectId: "",
					}),
				(error: unknown) => harness.isNotFoundError(error),
			);
		});
	});
}
