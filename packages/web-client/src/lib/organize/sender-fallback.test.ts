import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildSenderFallbackDraft,
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

describe("deriveSenderClauses", () => {
	it("emits one From clause per distinct sender", () => {
		assert.deepEqual(
			deriveSenderClauses(["npm@github.com", "npm@github.com", "a@x.com"]),
			[
				{ field: "From", value: "npm@github.com" },
				{ field: "From", value: "a@x.com" },
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
});
