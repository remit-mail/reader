import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMinutesToClock } from "./event-phrase.js";

describe("addMinutesToClock", () => {
	it("advances a clock", () => {
		assert.equal(addMinutesToClock("13:00", 90), "14:30");
	});

	it("wraps past midnight", () => {
		assert.equal(addMinutesToClock("23:30", 60), "00:30");
	});

	it("returns nothing for no clock", () => {
		assert.equal(addMinutesToClock("", 60), "");
	});
});
