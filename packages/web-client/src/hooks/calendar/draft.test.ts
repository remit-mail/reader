/**
 * What the form sends, and what it refuses to send.
 *
 * The two rules worth pinning: a refusal names the field and the fix rather
 * than greying a button, and a patch carries only what changed. Absence means
 * untouched on this API, so a patch built from every field would write back the
 * empty location and notes a listing never carried and erase them without
 * anybody asking for that.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type CalendarEventData,
	type EventDraft,
	withAllDay,
	withStartDate,
} from "@remit/ui";
import {
	type CreateInput,
	createInputFromDraft,
	draftFromEvent,
	emptyDraft,
	patchFromDrafts,
	type UpdatePatch,
} from "./draft";

const CALENDAR = "cal_work";
const AMSTERDAM = "Europe/Amsterdam";
const NEW_YORK = "America/New_York";
const TOKYO = "Asia/Tokyo";
const IN_AMSTERDAM = { clock: AMSTERDAM, anchor: AMSTERDAM };

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
	...emptyDraft("2026-06-10", CALENDAR),
	title: "Roadmap review",
	...over,
});

const STORED = { repeat: "", location: "", notes: "" };

const event = (over: Partial<CalendarEventData>): CalendarEventData => ({
	id: "evt_1",
	calendarId: CALENDAR,
	title: "Roadmap review",
	start: "2026-06-10T09:00:00+02:00",
	end: "2026-06-10T10:00:00+02:00",
	allDay: false,
	location: "",
	notes: "",
	attendees: [],
	myRsvp: "accepted",
	threadId: "",
	threadSubject: "",
	timeZone: AMSTERDAM,
	zoneCertainty: "explicit",
	recurrenceRule: "",
	seriesId: "",
	seriesException: false,
	status: "confirmed",
	...over,
});

const refusal = (result: CreateInput | UpdatePatch): string => {
	assert.ok(
		!result.ok,
		"the draft was accepted where it should have been refused",
	);
	return result.problem;
};

describe("creating an event", () => {
	it("sends the calendar, the summary and a start with an offset", () => {
		const built = createInputFromDraft(draft(), IN_AMSTERDAM);
		assert.ok(built.ok);
		assert.equal(built.input.calendarId, CALENDAR);
		assert.equal(built.input.summary, "Roadmap review");
		assert.equal(built.input.timeZone, AMSTERDAM);
		assert.equal(built.input.start, "2026-06-10T09:00:00+02:00");
		assert.equal(built.input.end, "2026-06-10T10:00:00+02:00");
	});

	it("makes an all-day event a civil date ending on the next one", () => {
		const built = createInputFromDraft(
			draft({ allDay: true, startTime: "", endTime: "" }),
			IN_AMSTERDAM,
		);
		assert.ok(built.ok);
		assert.equal(built.input.start, "2026-06-10");
		assert.equal(built.input.end, "2026-06-11");
	});

	it("ends a night that runs past midnight on the next day", () => {
		const built = createInputFromDraft(
			draft({ startTime: "22:00", endDate: "2026-06-11", endTime: "01:00" }),
			IN_AMSTERDAM,
		);
		assert.ok(built.ok);
		assert.equal(built.input.start, "2026-06-10T22:00:00+02:00");
		assert.equal(built.input.end, "2026-06-11T01:00:00+02:00");
	});

	it("ends an all-day event the day after the last day it covers", () => {
		const built = createInputFromDraft(
			draft({
				allDay: true,
				startTime: "",
				endTime: "",
				endDate: "2026-06-12",
			}),
			IN_AMSTERDAM,
		);
		assert.ok(built.ok);
		assert.equal(built.input.start, "2026-06-10");
		assert.equal(built.input.end, "2026-06-13");
	});

	it("turns a picked repeat sentence into the rule it means", () => {
		const built = createInputFromDraft(
			draft({ repeat: "Every weekday, 09:00" }),
			IN_AMSTERDAM,
		);
		assert.ok(built.ok);
		assert.equal(
			built.input.recurrenceRule,
			"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
		);
	});
});

describe("a refusal", () => {
	it("names the missing title", () => {
		assert.match(
			refusal(createInputFromDraft(draft({ title: "  " }), IN_AMSTERDAM)),
			/title/i,
		);
	});

	it("names a span that runs backwards, and what to do about it", () => {
		assert.match(
			refusal(
				createInputFromDraft(
					draft({ startTime: "11:00", endTime: "10:00" }),
					IN_AMSTERDAM,
				),
			),
			/end is not after the start/i,
		);
	});

	it("names a last day before the first on an all-day event", () => {
		assert.match(
			refusal(
				createInputFromDraft(
					draft({
						allDay: true,
						startTime: "",
						endTime: "",
						endDate: "2026-06-09",
					}),
					IN_AMSTERDAM,
				),
			),
			/last day is before the first/i,
		);
	});

	it("names a missing time rather than saving a day-long event nobody asked for", () => {
		assert.match(
			refusal(createInputFromDraft(draft({ endTime: "" }), IN_AMSTERDAM)),
			/start and an end time/i,
		);
	});

	it("refuses a repeat rule it cannot store, and says to pick another", () => {
		assert.match(
			refusal(
				createInputFromDraft(
					draft({ repeat: "Every other Tuesday" }),
					IN_AMSTERDAM,
				),
			),
			/repeat rule/i,
		);
	});
});

describe("editing an event", () => {
	it("sends only the field that changed", () => {
		const before = draft({ location: "Room Zuid", notes: "Bring numbers." });
		const patch = patchFromDrafts(
			before,
			{ ...before, title: "Roadmap" },
			IN_AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { summary: "Roadmap" });
	});

	it("sends both ends and the all-day flag when the event moves", () => {
		const before = draft();
		const patch = patchFromDrafts(
			before,
			{ ...before, startTime: "08:00" },
			IN_AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.equal(patch.patch.allDay, false);
		assert.equal(patch.patch.start, "2026-06-10T08:00:00+02:00");
		assert.equal(patch.patch.end, "2026-06-10T10:00:00+02:00");
	});

	it("leaves an unreadable rule alone rather than refusing every other edit", () => {
		const before = draft({ repeat: "Repeats" });
		const patch = patchFromDrafts(
			before,
			{ ...before, title: "Standup" },
			IN_AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { summary: "Standup" });
	});

	it("drops the rule when the reader turns the repeat off", () => {
		const before = draft({ repeat: "Every weekday, 09:00" });
		const patch = patchFromDrafts(
			before,
			{ ...before, repeat: "" },
			IN_AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.equal(patch.patch.recurrenceRule, "");
	});

	it("saves another field of a night that runs past midnight", () => {
		const before = draftFromEvent(
			event({
				start: "2026-06-10T22:00:00+02:00",
				end: "2026-06-11T01:00:00+02:00",
			}),
			STORED,
		);
		assert.equal(before.endDate, "2026-06-11");
		const patch = patchFromDrafts(
			before,
			{ ...before, title: "Night shift" },
			IN_AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { summary: "Night shift" });
	});

	it("keeps every day of an all-day event it opens", () => {
		const before = draftFromEvent(
			event({ allDay: true, start: "2026-06-10", end: "2026-06-13" }),
			STORED,
		);
		assert.equal(before.date, "2026-06-10");
		assert.equal(before.endDate, "2026-06-12");
		const patch = patchFromDrafts(
			before,
			{ ...before, date: "2026-06-17", endDate: "2026-06-19" },
			IN_AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.equal(patch.patch.start, "2026-06-17");
		assert.equal(patch.patch.end, "2026-06-20");
	});

	it("changes nothing when nothing was touched", () => {
		const before = draft();
		const patch = patchFromDrafts(before, { ...before }, IN_AMSTERDAM);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, {});
	});
});

/**
 * The clock the form shows is the device's; the zone the event is anchored in
 * is the calendar's.
 *
 * Every surface draws occurrences on the device's clock and the form shows
 * those digits, so the offset has to be the device's — stamping the calendar's
 * onto them moves the event by the difference, six hours for an Amsterdam
 * calendar looked at from New York. The calendar's zone still travels as the
 * TZID, which is what keeps a series at its hour across a DST change.
 *
 * Both assertions are absolute rather than "whatever this runner is on": the
 * bug is precisely that the runner's zone leaked in, so a test that reads it is
 * a test that cannot see the bug.
 */
describe("an event anchored somewhere other than the device", () => {
	it("pins a new event to the device's clock and anchors it in the calendar's zone", () => {
		const built = createInputFromDraft(draft(), {
			clock: NEW_YORK,
			anchor: AMSTERDAM,
		});
		assert.ok(built.ok);
		assert.equal(built.input.start, "2026-06-10T09:00:00-04:00");
		assert.equal(built.input.timeZone, AMSTERDAM);
	});

	it("moves an event to another day without moving it to another hour", () => {
		const before = draft();
		const patch = patchFromDrafts(
			before,
			{ ...before, date: "2026-06-17", endDate: "2026-06-17" },
			IN_AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.equal(patch.patch.start, "2026-06-17T09:00:00+02:00");
		assert.equal(patch.patch.end, "2026-06-17T10:00:00+02:00");
		assert.equal(
			patch.patch.timeZone,
			AMSTERDAM,
			"the offset pins the instant; the zone is what survives a DST change",
		);
	});

	it("reads the zone's own winter offset rather than one it saw in June", () => {
		const built = createInputFromDraft(
			draft({ date: "2026-01-14", endDate: "2026-01-14" }),
			IN_AMSTERDAM,
		);
		assert.ok(built.ok);
		assert.equal(built.input.start, "2026-01-14T09:00:00+01:00");
	});

	it("falls back to the device rather than refusing a zone nothing can resolve", () => {
		const built = createInputFromDraft(draft(), {
			clock: "Mars/Olympus_Mons",
			anchor: AMSTERDAM,
		});
		assert.ok(built.ok);
		assert.match(built.input.start, /^2026-06-10T09:00:00[+-]\d{2}:\d{2}$/);
	});

	/**
	 * The canonical IANA list holds no spelling of UTC, so there is nothing to
	 * send for a collection that names no zone. Absent is what the API asks for
	 * and the only thing it takes; the device's zone in its place was refused
	 * outright on a UTC runner.
	 */
	it("sends no zone at all where the collection names none", () => {
		const built = createInputFromDraft(draft(), { clock: "UTC", anchor: "" });
		assert.ok(built.ok);
		assert.equal(built.input.timeZone, undefined);
		assert.equal(built.input.start, "2026-06-10T09:00:00+00:00");
		assert.equal(built.input.end, "2026-06-10T10:00:00+00:00");
	});

	it("leaves the zone out of an edit on that collection too", () => {
		const before = draft();
		const patch = patchFromDrafts(
			before,
			{ ...before, date: "2026-06-17", endDate: "2026-06-17" },
			{ clock: "UTC", anchor: "" },
		);
		assert.ok(patch.ok);
		assert.equal(patch.patch.timeZone, undefined);
		assert.equal(patch.patch.start, "2026-06-17T09:00:00+00:00");
	});
});

describe("the form moving its own dates", () => {
	const weekend = draft({
		allDay: true,
		startTime: "",
		endTime: "",
		date: "2026-06-12",
		endDate: "2026-06-14",
	});

	it("carries the last day along when the first day moves", () => {
		const moved = withStartDate(weekend, "2026-06-19");
		assert.equal(moved.date, "2026-06-19");
		assert.equal(moved.endDate, "2026-06-21");
	});

	it("keeps the last day while the start date is cleared and retyped", () => {
		const cleared = withStartDate(weekend, "");
		assert.equal(cleared.endDate, "2026-06-14");
		const retyped = withStartDate(cleared, "2026-06-12");
		assert.equal(retyped.date, "2026-06-12");
		assert.equal(retyped.endDate, "2026-06-14");
	});

	it("makes a night that runs past midnight one all-day date", () => {
		const night = draft({
			startTime: "22:00",
			endDate: "2026-06-11",
			endTime: "01:00",
		});
		const allDay = withAllDay(night, true);
		assert.equal(allDay.allDay, true);
		assert.equal(allDay.endDate, "2026-06-10");
	});

	it("keeps the days of a timed event that spans them when made all day", () => {
		const span = draft({ endDate: "2026-06-12", endTime: "17:00" });
		assert.equal(withAllDay(span, true).endDate, "2026-06-12");
	});
});

/**
 * A Tokyo afternoon read in New York runs 23:30 to 00:30. The end digits are
 * before the start digits and the event is still an hour long.
 */
describe("an event that crosses midnight on the device's clock", () => {
	const FROM_NEW_YORK = { clock: NEW_YORK, anchor: TOKYO };
	const crossing = draft({
		startTime: "23:30",
		endDate: "2026-06-11",
		endTime: "00:30",
	});

	it("still takes an edit that leaves the times alone", () => {
		const patch = patchFromDrafts(
			crossing,
			{ ...crossing, title: "Roadmap" },
			FROM_NEW_YORK,
		);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { summary: "Roadmap" });
	});

	it("ends it the next morning when it moves day", () => {
		const patch = patchFromDrafts(
			crossing,
			{ ...crossing, date: "2026-06-17", endDate: "2026-06-18" },
			FROM_NEW_YORK,
		);
		assert.ok(patch.ok);
		assert.equal(patch.patch.start, "2026-06-17T23:30:00-04:00");
		assert.equal(patch.patch.end, "2026-06-18T00:30:00-04:00");
		assert.equal(patch.patch.timeZone, TOKYO);
	});
});

describe("a repeat picked on the device's day", () => {
	const FROM_NEW_YORK = { clock: NEW_YORK, anchor: TOKYO };
	const sundayNight = draft({
		date: "2026-06-14",
		endDate: "2026-06-14",
		startTime: "21:00",
		endTime: "22:00",
	});

	it("is stored on the day the event's own zone starts it on", () => {
		const built = createInputFromDraft(
			{ ...sundayNight, repeat: "Every week on Sunday, 21:00" },
			FROM_NEW_YORK,
		);
		assert.ok(built.ok);
		assert.equal(built.input.recurrenceRule, "FREQ=WEEKLY;BYDAY=MO");
	});

	it("keeps the day it was picked on where both clocks agree", () => {
		const built = createInputFromDraft(
			{ ...sundayNight, repeat: "Every week on Sunday, 21:00" },
			{ clock: NEW_YORK, anchor: NEW_YORK },
		);
		assert.ok(built.ok);
		assert.equal(built.input.recurrenceRule, "FREQ=WEEKLY;BYDAY=SU");
	});
});

describe("an edit to the end alone", () => {
	it("leaves the stored start as it is", () => {
		const before = draft();
		const patch = patchFromDrafts(
			before,
			{ ...before, endTime: "11:00" },
			IN_AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.equal(patch.patch.start, undefined);
		assert.equal(patch.patch.end, "2026-06-10T11:00:00+02:00");
	});
});

/**
 * An event stored as the UTC instant 2026-06-15T01:00Z: Sunday 21:00 in New
 * York, Monday 03:00 in Amsterdam. The server expands its rule in UTC, where
 * it is a Monday, whichever device picked the rule.
 */
describe("a repeat added to an event stored in UTC", () => {
	const inUtc = (clock: string) => ({ clock, anchor: "" });

	it("is stored on the UTC day from a New York device", () => {
		const before = draft({
			date: "2026-06-14",
			endDate: "2026-06-14",
			startTime: "21:00",
			endTime: "22:00",
		});
		const patch = patchFromDrafts(
			before,
			{ ...before, repeat: "Every week on Sunday, 21:00" },
			inUtc(NEW_YORK),
		);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { recurrenceRule: "FREQ=WEEKLY;BYDAY=MO" });
	});

	it("is stored on the UTC day from an Amsterdam device", () => {
		const before = draft({
			date: "2026-06-15",
			endDate: "2026-06-15",
			startTime: "03:00",
			endTime: "04:00",
		});
		const patch = patchFromDrafts(
			before,
			{ ...before, repeat: "Every week on Monday, 03:00" },
			inUtc(AMSTERDAM),
		);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { recurrenceRule: "FREQ=WEEKLY;BYDAY=MO" });
	});

	it("stays anchored in UTC when its time moves", () => {
		const before = draft({
			date: "2026-06-14",
			endDate: "2026-06-14",
			startTime: "21:00",
			endTime: "22:00",
		});
		const patch = patchFromDrafts(
			before,
			{ ...before, startTime: "21:30" },
			inUtc(NEW_YORK),
		);
		assert.ok(patch.ok);
		assert.equal(patch.patch.start, "2026-06-14T21:30:00-04:00");
		assert.equal(patch.patch.timeZone, undefined);
	});
});
