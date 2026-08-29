import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isDraggedSelection,
	pointPick,
	rangePick,
} from "./calendar-slot-pick.js";

describe("pointPick", () => {
	it("drafts an hour from the point that was clicked", () => {
		assert.deepEqual(pointPick("2026-06-10T14:30:00+02:00", false), {
			date: "2026-06-10",
			startTime: "14:30",
			endTime: "15:30",
			allDay: false,
		});
	});

	it("reads the clock off the string, not off the host's zone", () => {
		/* The same instant, written in two zones. A pick reads the wall clock the
		   grid drew, so each keeps its own — a Date would collapse both to the
		   runner's zone. */
		assert.equal(
			pointPick("2026-06-10T09:00:00+02:00", false).startTime,
			"09:00",
		);
		assert.equal(pointPick("2026-06-10T07:00:00Z", false).startTime, "07:00");
	});

	it("carries an all-day point with no clock at all", () => {
		assert.deepEqual(pointPick("2026-06-10", true), {
			date: "2026-06-10",
			startTime: "",
			endTime: "",
			allDay: true,
		});
	});

	it("rolls a draft that runs past midnight round the clock", () => {
		assert.equal(
			pointPick("2026-06-10T23:30:00+02:00", false).endTime,
			"00:30",
		);
	});
});

describe("rangePick", () => {
	it("keeps both ends of a dragged range", () => {
		assert.deepEqual(
			rangePick(
				"2026-06-10T09:00:00+02:00",
				"2026-06-10T11:30:00+02:00",
				false,
			),
			{
				date: "2026-06-10",
				startTime: "09:00",
				endTime: "11:30",
				allDay: false,
			},
		);
	});

	it("drops the clock off an all-day range", () => {
		assert.deepEqual(rangePick("2026-06-10", "2026-06-13", true), {
			date: "2026-06-10",
			startTime: "",
			endTime: "",
			allDay: true,
		});
	});
});

describe("isDraggedSelection", () => {
	const slot = 30;

	it("calls one slot a click, not a drag", () => {
		assert.equal(
			isDraggedSelection(
				"2026-06-10T09:00:00+02:00",
				"2026-06-10T09:30:00+02:00",
				false,
				slot,
			),
			false,
		);
	});

	it("calls anything wider than a slot a drag", () => {
		assert.equal(
			isDraggedSelection(
				"2026-06-10T09:00:00+02:00",
				"2026-06-10T10:00:00+02:00",
				false,
				slot,
			),
			true,
		);
	});

	it("measures against the slot in force, so a coarser grid clicks wider", () => {
		assert.equal(
			isDraggedSelection(
				"2026-06-10T09:00:00+02:00",
				"2026-06-10T10:00:00+02:00",
				false,
				60,
			),
			false,
		);
	});

	it("calls a single all-day cell a click", () => {
		assert.equal(
			isDraggedSelection("2026-06-10", "2026-06-11", true, slot),
			false,
		);
	});

	it("calls two all-day cells a drag", () => {
		assert.equal(
			isDraggedSelection("2026-06-10", "2026-06-12", true, slot),
			true,
		);
	});

	it("survives a day that changed length under it", () => {
		/* The Amsterdam DST spring forward: 25 to 26 October is 25 hours long, and
		   rounding is what keeps that one cell a click. */
		assert.equal(
			isDraggedSelection(
				"2026-10-25T00:00:00+02:00",
				"2026-10-26T00:00:00+01:00",
				true,
				slot,
			),
			false,
		);
	});
});
