import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSenderFallbackDraft } from "./sender-fallback";

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
