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
		const built = createInputFromDraft(draft(), "Europe/Amsterdam");
		assert.ok(built.ok);
		assert.equal(built.input.calendarId, CALENDAR);
		assert.equal(built.input.summary, "Roadmap review");
		assert.equal(built.input.timeZone, "Europe/Amsterdam");
		assert.match(built.input.start, /^2026-06-10T09:00:00[+-]\d{2}:\d{2}$/);
		assert.match(built.input.end, /^2026-06-10T10:00:00[+-]\d{2}:\d{2}$/);
	});

	it("makes an all-day event a civil date ending on the next one", () => {
		const built = createInputFromDraft(
			draft({ allDay: true, startTime: "", endTime: "" }),
			"Europe/Amsterdam",
		);
		assert.ok(built.ok);
		assert.equal(built.input.start, "2026-06-10");
		assert.equal(built.input.end, "2026-06-11");
	});

	it("turns a picked repeat sentence into the rule it means", () => {
		const built = createInputFromDraft(
			draft({ repeat: "Every weekday, 09:00" }),
			"Europe/Amsterdam",
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
			refusal(createInputFromDraft(draft({ title: "  " }), "UTC")),
			/title/i,
		);
	});

	it("names a span that runs backwards, and what to do about it", () => {
		assert.match(
			refusal(
				createInputFromDraft(
					draft({ startTime: "11:00", endTime: "10:00" }),
					"UTC",
				),
			),
			/end time is not after the start time/i,
		);
	});

	it("names a missing time rather than saving a day-long event nobody asked for", () => {
		assert.match(
			refusal(createInputFromDraft(draft({ endTime: "" }), "UTC")),
			/start and an end time/i,
		);
	});

	it("refuses a repeat rule it cannot store, and says to pick another", () => {
		assert.match(
			refusal(
				createInputFromDraft(draft({ repeat: "Every other Tuesday" }), "UTC"),
			),
			/repeat rule/i,
		);
	});
});

describe("editing an event", () => {
	it("sends only the field that changed", () => {
		const before = draft({ location: "Room Zuid", notes: "Bring numbers." });
		const patch = patchFromDrafts(before, { ...before, title: "Roadmap" });
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { summary: "Roadmap" });
	});

	it("sends both ends and the all-day flag when the event moves", () => {
		const before = draft();
		const patch = patchFromDrafts(before, { ...before, startTime: "08:00" });
		assert.ok(patch.ok);
		assert.equal(patch.patch.allDay, false);
		assert.match(patch.patch.start ?? "", /^2026-06-10T08:00:00/);
		assert.match(patch.patch.end ?? "", /^2026-06-10T10:00:00/);
	});

	it("leaves an unreadable rule alone rather than refusing every other edit", () => {
		const before = draft({ repeat: "Repeats" });
		const patch = patchFromDrafts(before, { ...before, title: "Standup" });
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, { summary: "Standup" });
	});

	it("drops the rule when the reader turns the repeat off", () => {
		const before = draft({ repeat: "Every weekday, 09:00" });
		const patch = patchFromDrafts(before, { ...before, repeat: "" });
		assert.ok(patch.ok);
		assert.equal(patch.patch.recurrenceRule, "");
	});

	it("changes nothing when nothing was touched", () => {
		const before = draft();
		const patch = patchFromDrafts(before, { ...before });
		assert.ok(patch.ok);
		assert.deepEqual(patch.patch, {});
	});
});
