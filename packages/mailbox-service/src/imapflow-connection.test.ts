import assert from "node:assert";
import { describe, it } from "node:test";
import { toIsoDateString } from "./imapflow-connection.js";

describe("toIsoDateString", () => {
	it("converts a Date to an ISO string", () => {
		const date = new Date("2026-06-21T10:20:30.000Z");
		assert.strictEqual(toIsoDateString(date), "2026-06-21T10:20:30.000Z");
	});

	it("converts a date string to an ISO string", () => {
		assert.strictEqual(
			toIsoDateString("2026-06-21T10:20:30.000Z"),
			"2026-06-21T10:20:30.000Z",
		);
	});

	it("converts an epoch number to an ISO string", () => {
		assert.strictEqual(toIsoDateString(0), new Date(0).toISOString());
	});

	it('returns "" for an invalid date string', () => {
		assert.strictEqual(toIsoDateString("not a date"), "");
	});

	it('returns "" for an invalid Date', () => {
		assert.strictEqual(toIsoDateString(new Date("not a date")), "");
	});

	it('returns "" for undefined', () => {
		assert.strictEqual(toIsoDateString(undefined), "");
	});

	it('returns "" for null', () => {
		assert.strictEqual(toIsoDateString(null), "");
	});

	it('returns "" for a non-Date value without toISOString instead of throwing', () => {
		assert.strictEqual(toIsoDateString({ foo: "bar" }), "");
	});
});
