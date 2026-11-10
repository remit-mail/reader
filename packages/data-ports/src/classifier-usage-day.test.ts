import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	callsOn,
	nextUtcMidnight,
	utcDateOf,
} from "./classification-presets.js";

const LATE_EVENING_UTC = Date.UTC(2026, 10, 10, 23, 59, 59, 999);
const JUST_AFTER_MIDNIGHT_UTC = Date.UTC(2026, 10, 11, 0, 0, 0, 0);

describe("a classification usage day", () => {
	it("is the UTC date, whatever the local clock says", () => {
		assert.equal(utcDateOf(LATE_EVENING_UTC), "2026-11-10");
		assert.equal(utcDateOf(JUST_AFTER_MIDNIGHT_UTC), "2026-11-11");
	});

	it("counts the calls stored for today", () => {
		assert.equal(
			callsOn({ date: "2026-11-10", calls: 499 }, "2026-11-10"),
			499,
		);
	});

	it("reads a value with an earlier date as zero calls", () => {
		assert.equal(callsOn({ date: "2026-11-09", calls: 500 }, "2026-11-10"), 0);
	});

	it("reads no value as zero calls", () => {
		assert.equal(callsOn(undefined, "2026-11-10"), 0);
	});

	it("resets at the next 00:00 UTC", () => {
		assert.equal(nextUtcMidnight(LATE_EVENING_UTC), "2026-11-11T00:00:00.000Z");
		assert.equal(
			nextUtcMidnight(JUST_AFTER_MIDNIGHT_UTC),
			"2026-11-12T00:00:00.000Z",
		);
	});
});
