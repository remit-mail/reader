import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	filterDisplayStatus,
	formatExpiresAt,
	pickedDateToExpiresAt,
} from "./filter-status";

const NOW = Date.parse("2026-07-12T12:00:00Z");

describe("filterDisplayStatus", () => {
	it("treats a Standing filter as always Active", () => {
		assert.equal(
			filterDisplayStatus({ scope: "Standing", state: "Active" }, NOW),
			"Active",
		);
	});

	it("treats a Temporary filter past its expiresAt as Expired even when state still caches Active (RFC 034 Decision 1.2)", () => {
		assert.equal(
			filterDisplayStatus(
				{
					scope: "Temporary",
					state: "Active",
					expiresAt: "2026-07-10T00:00:00Z",
				},
				NOW,
			),
			"Expired",
		);
	});

	it("treats a Temporary filter before its expiresAt as Active", () => {
		assert.equal(
			filterDisplayStatus(
				{
					scope: "Temporary",
					state: "Active",
					expiresAt: "2026-07-20T00:00:00Z",
				},
				NOW,
			),
			"Active",
		);
	});

	it("honors a state the server already flipped to Expired", () => {
		assert.equal(
			filterDisplayStatus(
				{
					scope: "Temporary",
					state: "Expired",
					expiresAt: "2026-07-20T00:00:00Z",
				},
				NOW,
			),
			"Expired",
		);
	});
});

describe("formatExpiresAt", () => {
	it("returns undefined for a missing value", () => {
		assert.equal(formatExpiresAt(undefined), undefined);
	});

	it("returns undefined for an unparseable value", () => {
		assert.equal(formatExpiresAt("not-a-date"), undefined);
	});

	it("renders a parseable date", () => {
		assert.equal(typeof formatExpiresAt("2026-07-16T23:59:59+02:00"), "string");
	});
});

describe("pickedDateToExpiresAt", () => {
	it("returns undefined for empty input", () => {
		assert.equal(pickedDateToExpiresAt(""), undefined);
	});

	it("returns undefined for a non date-only string", () => {
		assert.equal(pickedDateToExpiresAt("2026/07/16"), undefined);
	});

	it("produces an ISO 8601 timestamp with a zone offset at end of the picked day", () => {
		const utcReference = new Date("2026-07-12T12:00:00Z");
		const result = pickedDateToExpiresAt("2026-07-16", utcReference);
		assert.equal(result, "2026-07-16T23:59:59+00:00");
	});

	it("round-trips back to the same calendar day it was expiring on", () => {
		const iso = pickedDateToExpiresAt(
			"2026-07-16",
			new Date("2026-07-12T12:00:00Z"),
		);
		assert.ok(iso);
		assert.equal(new Date(Date.parse(iso)).getUTCDate(), 16);
	});
});
