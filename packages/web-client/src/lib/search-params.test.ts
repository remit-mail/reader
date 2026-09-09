/**
 * The spelling the address bar is written in.
 *
 * The router reads a repeated param as a list already; this is the other half,
 * and the assertions are the round trip — anything written here has to come
 * back the value it went in as.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSearchWith } from "@tanstack/react-router";
import { stringifySearch } from "./search-params.js";

/** The router's own reader, which this module has to stay symmetrical with. */
const parseSearch = parseSearchWith(JSON.parse);

/** Spread, because the router's reader answers with a null-prototype object. */
const roundTrip = (search: Record<string, unknown>): unknown => ({
	...parseSearch(stringifySearch(search)),
});

describe("stringifySearch", () => {
	it("writes a list as the repeated params it is", () => {
		assert.equal(
			stringifySearch({ calendarId: ["cal_a", "cal_b"] }),
			"?calendarId=cal_a&calendarId=cal_b",
		);
	});

	it("writes a list of one as one param", () => {
		assert.equal(
			stringifySearch({ calendarId: ["cal_a"] }),
			"?calendarId=cal_a",
		);
	});

	it("writes nothing for an empty list, an absent value, or no params", () => {
		assert.equal(stringifySearch({ calendarId: [] }), "");
		assert.equal(stringifySearch({ q: undefined }), "");
		assert.equal(stringifySearch({}), "");
	});

	it("leaves an ordinary value the way the router already wrote it", () => {
		assert.equal(stringifySearch({ q: "invoice" }), "?q=invoice");
		assert.equal(stringifySearch({ wizard: "review" }), "?wizard=review");
	});

	it("percent-encodes what a query string cannot carry raw", () => {
		assert.equal(stringifySearch({ q: "from:ada &c" }), "?q=from%3Aada+%26c");
	});
});

describe("what is written comes back", () => {
	it("gives a list back as a list", () => {
		assert.deepEqual(roundTrip({ calendarId: ["cal_a", "cal_b"] }), {
			calendarId: ["cal_a", "cal_b"],
		});
	});

	it("gives text that reads as JSON back as text", () => {
		// Unquoted, the reader would hand back a boolean and a number.
		assert.deepEqual(roundTrip({ q: "true" }), { q: "true" });
		assert.deepEqual(roundTrip({ q: "2026" }), { q: "2026" });
		assert.deepEqual(roundTrip({ q: "[draft]" }), { q: "[draft]" });
	});

	it("gives ordinary text back unchanged", () => {
		assert.deepEqual(roundTrip({ q: "from:ada invoice" }), {
			q: "from:ada invoice",
		});
	});

	it("gives a structure back as a structure", () => {
		assert.deepEqual(roundTrip({ filter: { unread: true } }), {
			filter: { unread: true },
		});
	});
});
