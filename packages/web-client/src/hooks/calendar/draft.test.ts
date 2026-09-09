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
import type { EventDraft } from "@remit/ui";
import {
	type CreateInput,
	createInputFromDraft,
	emptyDraft,
	patchFromDrafts,
	type UpdatePatch,
} from "./draft";

const CALENDAR = "cal_work";
const AMSTERDAM = "Europe/Amsterdam";
const NEW_YORK = "America/New_York";

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
	...emptyDraft("2026-06-10", CALENDAR),
	title: "Roadmap review",
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
		const built = createInputFromDraft(draft(), AMSTERDAM);
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
			AMSTERDAM,
		);
		assert.ok(built.ok);
		assert.equal(built.input.start, "2026-06-10");
		assert.equal(built.input.end, "2026-06-11");
	});

	it("turns a picked repeat sentence into the rule it means", () => {
		const built = createInputFromDraft(
			draft({ repeat: "Every weekday, 09:00" }),
			AMSTERDAM,
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
			refusal(createInputFromDraft(draft({ title: "  " }), AMSTERDAM)),
			/title/i,
		);
	});

	it("names a span that runs backwards, and what to do about it", () => {
		assert.match(
			refusal(
				createInputFromDraft(
					draft({ startTime: "11:00", endTime: "10:00" }),
					AMSTERDAM,
				),
			),
			/end time is not after the start time/i,
		);
	});

	it("names a missing time rather than saving a day-long event nobody asked for", () => {
		assert.match(
			refusal(createInputFromDraft(draft({ endTime: "" }), AMSTERDAM)),
			/start and an end time/i,
		);
	});

	it("refuses a repeat rule it cannot store, and says to pick another", () => {
		assert.match(
			refusal(
				createInputFromDraft(
					draft({ repeat: "Every other Tuesday" }),
					AMSTERDAM,
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
			AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { summary: "Roadmap" });
	});

	it("sends both ends and the all-day flag when the event moves", () => {
		const before = draft();
		const patch = patchFromDrafts(
			before,
			{ ...before, startTime: "08:00" },
			AMSTERDAM,
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
			AMSTERDAM,
		);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { summary: "Standup" });
	});

	it("drops the rule when the reader turns the repeat off", () => {
		const before = draft({ repeat: "Every weekday, 09:00" });
		const patch = patchFromDrafts(before, { ...before, repeat: "" }, AMSTERDAM);
		assert.ok(patch.ok);
		assert.equal(patch.patch.recurrenceRule, "");
	});

	it("changes nothing when nothing was touched", () => {
		const before = draft();
		const patch = patchFromDrafts(before, { ...before }, AMSTERDAM);
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, {});
	});
});

/**
 * The clock the form shows is the calendar's, not the device's.
 *
 * An occurrence is returned in the collection's zone and the form displays
 * those digits, so rebuilding them with whatever offset the reader's laptop
 * happens to be on moves the event by the difference — six hours for the same
 * meeting looked at from New York, with nothing on screen saying it moved.
 *
 * Both assertions are absolute rather than "whatever this runner is on": the
 * bug is precisely that the runner's zone leaked in, so a test that reads it is
 * a test that cannot see the bug.
 */
describe("an event anchored somewhere other than the device", () => {
	it("keeps a new event on the calendar's clock", () => {
		const built = createInputFromDraft(draft(), NEW_YORK);
		assert.ok(built.ok);
		assert.equal(built.input.start, "2026-06-10T09:00:00-04:00");
		assert.equal(built.input.timeZone, NEW_YORK);
	});

	it("moves an event to another day without moving it to another hour", () => {
		const before = draft();
		const patch = patchFromDrafts(
			before,
			{ ...before, date: "2026-06-17" },
			AMSTERDAM,
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
			draft({ date: "2026-01-14" }),
			AMSTERDAM,
		);
		assert.ok(built.ok);
		assert.equal(built.input.start, "2026-01-14T09:00:00+01:00");
	});

	it("falls back to the device rather than refusing a zone nothing can resolve", () => {
		const built = createInputFromDraft(draft(), "Mars/Olympus_Mons");
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
		const built = createInputFromDraft(draft(), "");
		assert.ok(built.ok);
		assert.equal(built.input.timeZone, undefined);
		assert.equal(built.input.start, "2026-06-10T09:00:00+00:00");
		assert.equal(built.input.end, "2026-06-10T10:00:00+00:00");
	});

	it("leaves the zone out of an edit on that collection too", () => {
		const before = draft();
		const patch = patchFromDrafts(
			before,
			{ ...before, date: "2026-06-17" },
			"",
		);
		assert.ok(patch.ok);
		assert.equal(patch.patch.timeZone, undefined);
		assert.equal(patch.patch.start, "2026-06-17T09:00:00+00:00");
	});
});
