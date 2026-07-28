/**
 * The opening clauses a properties-only rule offers (RFC 038 D2/D4). The
 * prefill is a starting point the user edits, so the contract worth holding is
 * the order of evidence — sender before subject, and nothing at all rather than
 * a guess that matches half a mailbox.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	derivePropertyClauses,
	normalizeSubject,
	sharedSubjectFragment,
} from "./property-prefill.js";

describe("normalizeSubject", () => {
	it("strips stacked reply, forward, and list decorations", () => {
		assert.equal(
			normalizeSubject("Re: Fwd: [ops] Invoice 1841"),
			"Invoice 1841",
		);
		assert.equal(normalizeSubject("RE[2]: Invoice 1841"), "Invoice 1841");
		assert.equal(normalizeSubject("AW: SV: Invoice 1841"), "Invoice 1841");
	});

	it("collapses whitespace and trims", () => {
		assert.equal(normalizeSubject("  Invoice   1841  "), "Invoice 1841");
	});

	it("leaves a subject that is only decoration empty", () => {
		assert.equal(normalizeSubject("Re: "), "");
	});
});

describe("sharedSubjectFragment", () => {
	it("takes the longest run of whole words every subject carries", () => {
		assert.equal(
			sharedSubjectFragment([
				"Invoice 1841",
				"Invoice 1902",
				"Re: Invoice 2003",
			]),
			"Invoice",
		);
	});

	it("matches case-insensitively and answers in the first subject's casing", () => {
		assert.equal(
			sharedSubjectFragment(["Invoice 1841", "INVOICE 1902"]),
			"Invoice",
		);
	});

	it("compares whole words, never a partial one", () => {
		// "Invoice 18" is a shared character run and not a shared word run.
		assert.equal(
			sharedSubjectFragment(["Invoice 1841", "Invoice 1892"]),
			"Invoice",
		);
	});

	it("keeps a single subject as its own fragment", () => {
		assert.equal(sharedSubjectFragment(["Invoice 1841"]), "Invoice 1841");
	});

	it("rejects a single subject that is nothing but filler", () => {
		assert.equal(sharedSubjectFragment(["for you"]), undefined);
	});

	it("rejects a shared run of filler words", () => {
		assert.equal(
			sharedSubjectFragment(["the report", "the summary"]),
			undefined,
		);
	});

	it("rejects a shared run too short to be worth matching", () => {
		assert.equal(
			sharedSubjectFragment(["Q3 numbers", "Q3 results"]),
			undefined,
		);
	});

	it("is undefined when the subjects share nothing", () => {
		assert.equal(
			sharedSubjectFragment(["Invoice 1841", "Standup notes"]),
			undefined,
		);
	});

	it("is undefined when no subject survives normalizing", () => {
		assert.equal(sharedSubjectFragment(["Re:", "   "]), undefined);
	});
});

describe("derivePropertyClauses", () => {
	it("matches on the sender when the whole selection is from one address", () => {
		assert.deepEqual(
			derivePropertyClauses(
				["npm@github.com", "npm@github.com", "npm@github.com"],
				["Invoice 1841", "Standup notes", "Deploy failed"],
			),
			[{ field: "From", value: "npm@github.com" }],
		);
	});

	it("matches on the domain when several senders share one", () => {
		assert.deepEqual(
			derivePropertyClauses(
				["npm@github.com", "notifications@github.com", "ci@sub.github.com"],
				["Invoice 1841", "Standup notes", "Deploy failed"],
			),
			[{ field: "FromDomain", value: "github.com" }],
		);
	});

	it("prefers the sender over the subject even when the subjects share a run", () => {
		assert.deepEqual(
			derivePropertyClauses(
				["npm@github.com", "npm@github.com"],
				["Invoice 1841", "Invoice 1902"],
			),
			[{ field: "From", value: "npm@github.com" }],
		);
	});

	it("falls back to what mixed senders' subjects have in common", () => {
		assert.deepEqual(
			derivePropertyClauses(
				["billing@acme.test", "accounts@globex.test", "ap@initech.test"],
				["Invoice 1841", "Invoice 1902", "Re: Invoice 2003"],
			),
			[{ field: "Subject", value: "Invoice" }],
		);
	});

	it("offers one sender chip each when mixed senders share no subject either", () => {
		assert.deepEqual(
			derivePropertyClauses(
				["billing@acme.test", "accounts@globex.test"],
				["Invoice 1841", "Standup notes"],
			),
			[
				{ field: "From", value: "billing@acme.test" },
				{ field: "From", value: "accounts@globex.test" },
			],
		);
	});

	it("refuses a filler-only subject run rather than prefilling a wide match", () => {
		assert.deepEqual(
			derivePropertyClauses(
				["billing@acme.test", "accounts@globex.test"],
				["the report", "the summary"],
			),
			[
				{ field: "From", value: "billing@acme.test" },
				{ field: "From", value: "accounts@globex.test" },
			],
		);
	});

	it("reads a single message as its own sender", () => {
		assert.deepEqual(
			derivePropertyClauses(["billing@acme.test"], ["Invoice 1841"]),
			[{ field: "From", value: "billing@acme.test" }],
		);
	});

	it("offers nothing when the selection carries no sender and no shared subject", () => {
		assert.deepEqual(derivePropertyClauses([], ["Re:", "   "]), []);
	});
});
