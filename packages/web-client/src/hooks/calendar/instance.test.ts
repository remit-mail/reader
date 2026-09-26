/** An occurrence as the calendar draws it, and the zone a write anchors it in. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapCalendarEventInstance } from "@remit/api-http-client/types.gen.ts";
import {
	anchorZoneFor,
	seriesOccurrenceOf,
	toCalendarEventData,
} from "./instance";

const instance = (
	over: Partial<RemitImapCalendarEventInstance>,
): RemitImapCalendarEventInstance =>
	({
		calendarId: "cal_work",
		calendarObjectId: "obj_1",
		recurrenceId: "",
		icalUid: "uid-1",
		summary: "Audit day",
		start: "2034-03-01T00:00:00+09:00",
		end: "2034-03-02T00:00:00+09:00",
		allDay: true,
		status: "Confirmed",
		transparency: "Opaque",
		zoneCertainty: "Explicit",
		etag: "etag-1",
		hasRecurrence: false,
		...over,
	}) as RemitImapCalendarEventInstance;

describe("an occurrence drawn on a device", () => {
	it("keeps an all-day occurrence on its civil date wherever the device is", () => {
		const drawn = toCalendarEventData(
			instance({}),
			"Asia/Tokyo",
			"Pacific/Pago_Pago",
		);
		assert.equal(drawn.start, "2034-03-01");
		assert.equal(drawn.end, "2034-03-02");
	});

	it("re-reads a timed occurrence on the device's clock", () => {
		const drawn = toCalendarEventData(
			instance({
				allDay: false,
				start: "2034-02-22T08:00:00+09:00",
				end: "2034-02-22T09:00:00+09:00",
			}),
			"Asia/Tokyo",
			"America/New_York",
		);
		assert.equal(drawn.start, "2034-02-21T18:00:00-05:00");
		assert.equal(drawn.end, "2034-02-21T19:00:00-05:00");
	});
});

describe("the zone a write anchors an event in", () => {
	it("is the collection's where it names one", () => {
		assert.equal(anchorZoneFor("Asia/Tokyo"), "Asia/Tokyo");
	});

	it("is the device's where the collection names none, and nothing on UTC", () => {
		const runner = process.env.TZ;
		try {
			process.env.TZ = "America/New_York";
			assert.equal(anchorZoneFor(""), "America/New_York");
			process.env.TZ = "UTC";
			assert.equal(anchorZoneFor(""), "");
		} finally {
			if (runner === undefined) Reflect.deleteProperty(process.env, "TZ");
			else process.env.TZ = runner;
		}
	});
});

describe("the occurrence a series opens at from its plain address", () => {
	const weekly = ["06", "13", "20"].map((day) =>
		toCalendarEventData(
			instance({
				recurrenceId: `203403${day}T090000Z`,
				hasRecurrence: true,
				allDay: false,
				start: `2034-03-${day}T09:00:00+00:00`,
				end: `2034-03-${day}T10:00:00+00:00`,
			}),
			"UTC",
			"UTC",
		),
	);
	const shuffled = [...weekly].reverse();

	it("is the next one still to finish", () => {
		assert.deepEqual(
			seriesOccurrenceOf(shuffled, "obj_1", "2034-03-13T09:30:00Z"),
			{ calendarObjectId: "obj_1", recurrenceId: "20340313T090000Z" },
		);
	});

	it("is the first in the window once every one has passed", () => {
		assert.deepEqual(
			seriesOccurrenceOf(shuffled, "obj_1", "2034-04-01T00:00:00Z"),
			{ calendarObjectId: "obj_1", recurrenceId: "20340306T090000Z" },
		);
	});

	it("is nothing for an event that does not recur or is not in the window", () => {
		const oneOff = toCalendarEventData(
			instance({ calendarObjectId: "obj_2" }),
			"UTC",
			"UTC",
		);
		assert.equal(
			seriesOccurrenceOf(
				[oneOff, ...shuffled],
				"obj_2",
				"2034-03-01T00:00:00Z",
			),
			undefined,
		);
		assert.equal(
			seriesOccurrenceOf(shuffled, "obj_3", "2034-03-01T00:00:00Z"),
			undefined,
		);
	});
});
