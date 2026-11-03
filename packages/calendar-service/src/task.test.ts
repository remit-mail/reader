import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildTaskCalendar,
	prepareCalendarTask,
	updateTaskCalendar,
} from "./task.js";

const NOW = new Date("2026-09-01T12:00:00Z");
const COLLECTION = { calendarId: "tasks-1", timezone: "Europe/Amsterdam" };

const built = (due: string, allDay: boolean): string => {
	const result = buildTaskCalendar(
		{
			summary: "Send the report",
			description: "",
			due,
			allDay,
			timeZone: allDay ? "" : "Europe/Amsterdam",
			completed: false,
		},
		"task@test",
		NOW,
	);
	assert.ok(result.ok, JSON.stringify(result));
	return result.value;
};

describe("prepareCalendarTask", () => {
	it("projects a timed DUE as its zoned time and its UTC instant", async () => {
		const row = await prepareCalendarTask(
			COLLECTION,
			"task.ics",
			built("2026-09-07T14:00:00+02:00", false),
		);
		assert.ok(row.ok, JSON.stringify(row));
		assert.equal(row.value.due, "2026-09-07T14:00:00+02:00");
		assert.equal(row.value.dueAt, "2026-09-07T12:00:00Z");
		assert.equal(row.value.allDay, false);
		assert.equal(row.value.completed, false);
		assert.equal(row.value.summary, "Send the report");
	});

	it("projects a DUE date as midnight of that day in the collection's zone", async () => {
		const row = await prepareCalendarTask(
			COLLECTION,
			"task.ics",
			built("2026-09-07", true),
		);
		assert.ok(row.ok, JSON.stringify(row));
		assert.equal(row.value.allDay, true);
		assert.equal(row.value.due, "2026-09-07T00:00:00+02:00");
		assert.equal(row.value.dueAt, "2026-09-06T22:00:00Z");
	});

	it("reads a task marked done as completed, and undone again", async () => {
		const done = await updateTaskCalendar(
			built("2026-09-07", true),
			{ completed: true },
			COLLECTION.timezone,
			NOW,
		);
		assert.ok(done.ok);
		assert.match(done.value, /STATUS:COMPLETED/);
		const undone = await updateTaskCalendar(
			done.value,
			{ completed: false },
			COLLECTION.timezone,
			NOW,
		);
		assert.ok(undone.ok);
		const row = await prepareCalendarTask(COLLECTION, "task.ics", undone.value);
		assert.ok(row.ok);
		assert.equal(row.value.completed, false);
		assert.doesNotMatch(undone.value, /COMPLETED:/);
	});

	it("refuses a VCALENDAR holding an event rather than a task", async () => {
		const row = await prepareCalendarTask(
			COLLECTION,
			"event.ics",
			[
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:e@test",
				"DTSTART:20260907T090000Z",
				"END:VEVENT",
				"END:VCALENDAR",
			].join("\r\n"),
		);
		assert.equal(row.ok, false);
	});
});
