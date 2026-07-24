import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildSenderFallbackDraft,
	collapsibleDomain,
	deriveSenderClauses,
	distinctSenders,
} from "./sender-fallback";

describe("distinctSenders", () => {
	it("drops empties and blanks, trimming what remains", () => {
		assert.deepEqual(
			distinctSenders(["  npm@github.com ", "", "   ", "a@x.com"]),
			["npm@github.com", "a@x.com"],
		);
	});

	it("de-duplicates case-insensitively, keeping first-seen casing and order", () => {
		assert.deepEqual(
			distinctSenders([
				"NPM@github.com",
				"a@x.com",
				"npm@GITHUB.com",
				"a@x.com",
			]),
			["NPM@github.com", "a@x.com"],
		);
	});
});

describe("collapsibleDomain", () => {
	it("returns the shared registrable domain when every sender matches it", () => {
		assert.equal(
			collapsibleDomain([
				"npm@github.com",
				"notifications@github.com",
				"ci@sub.github.com",
			]),
			"github.com",
		);
	});

	it("does not collapse a single sender to its whole domain", () => {
		assert.equal(collapsibleDomain(["npm@github.com"]), null);
	});

	it("does not collapse when a sender's domain differs", () => {
		assert.equal(collapsibleDomain(["npm@github.com", "a@x.com"]), null);
	});

	it("does not collapse when any sender's domain cannot be resolved", () => {
		assert.equal(
			collapsibleDomain(["npm@github.com", "malformed-no-at-sign"]),
			null,
		);
	});
});

describe("deriveSenderClauses", () => {
	it("emits one From clause per distinct sender when domains differ", () => {
		assert.deepEqual(
			deriveSenderClauses(["npm@github.com", "npm@github.com", "a@x.com"]),
			[
				{ field: "From", value: "npm@github.com" },
				{ field: "From", value: "a@x.com" },
			],
		);
	});

	it("collapses to a single FromDomain clause when every sender shares a domain", () => {
		assert.deepEqual(
			deriveSenderClauses([
				"npm@github.com",
				"notifications@github.com",
				"ci@sub.github.com",
			]),
			[{ field: "FromDomain", value: "github.com" }],
		);
	});

	it("keeps per-address From clauses for the mixed case", () => {
		assert.deepEqual(
			deriveSenderClauses([
				"npm@github.com",
				"ci@github.com",
				"newsletter@example.org",
			]),
			[
				{ field: "From", value: "npm@github.com" },
				{ field: "From", value: "ci@github.com" },
				{ field: "From", value: "newsletter@example.org" },
			],
		);
	});

	it("is empty when no sender survives", () => {
		assert.deepEqual(deriveSenderClauses(["", "  "]), []);
	});
});

describe("buildSenderFallbackDraft", () => {
	it("combines the sender clauses with Or and carries no anchor", () => {
		const draft = buildSenderFallbackDraft(["npm@github.com", "a@x.com"]);
		assert.equal(draft.matchOperator, "Or");
		assert.equal(draft.anchorMessageId, undefined);
		assert.deepEqual(draft.literalClauses, [
			{ field: "From", value: "npm@github.com" },
			{ field: "From", value: "a@x.com" },
		]);
	});

	it("carries a single FromDomain clause when the senders share a domain", () => {
		const draft = buildSenderFallbackDraft(["npm@github.com", "ci@github.com"]);
		assert.equal(draft.matchOperator, "Or");
		assert.deepEqual(draft.literalClauses, [
			{ field: "FromDomain", value: "github.com" },
		]);
	});
});
