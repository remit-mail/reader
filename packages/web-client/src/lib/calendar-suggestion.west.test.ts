/**
 * An all-day invitation read west of the zone it was sent from (#1277 review).
 *
 * Midnight in the organiser's zone is the previous evening in New York, so a
 * date read as an instant lands a day early. The zone is set before the module
 * loads, because a formatter settles its zone when it is built.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.TZ = "America/New_York";
const { suggestionDate, suggestionWhen } = await import("./calendar-suggestion");

const allDay = {
	suggestionId: "sug-1",
	accountConfigId: "cfg-1",
	messageId: "msg-1",
	bodyPartId: "part-1",
	icalUid: "uid-1",
	sequence: 0,
	method: "Request",
	source: "IcalendarPart",
	state: "Pending",
	summary: "Offsite",
	dtStart: "2027-03-10T00:00:00+00:00",
	dtEnd: "2027-03-11T00:00:00+00:00",
	allDay: true,
	location: "",
	organizer: "organizer@example.test",
	zoneCertainty: "Explicit",
	acceptedCalendarObjectId: "",
	createdAt: 0,
	updatedAt: 0,
} as const;

describe("an all-day invitation, west of where it was sent", () => {
	it("names the day it was sent for, not the evening before", () => {
		const when = suggestionWhen(allDay);
		assert.match(when, /Wed/);
		assert.match(when, /\b10\b/);
		assert.match(when, /all day$/);
		assert.doesNotMatch(when, /Tue|\b9\b/);
		assert.equal(suggestionDate(allDay), "2027-03-10");
	});

	it("names the last day of a multi-day one, not the exclusive end", () => {
		const when = suggestionWhen({
			...allDay,
			dtEnd: "2027-03-13T00:00:00+00:00",
		});
		assert.match(when, /Wed.*\b10\b.*–.*Fri.*\b12\b/);
		assert.doesNotMatch(when, /Sat|\b13\b/);
	});
});
