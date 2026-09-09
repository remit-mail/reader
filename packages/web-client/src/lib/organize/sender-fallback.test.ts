import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSenderFallbackDraft } from "./sender-fallback";

describe("buildSenderFallbackDraft", () => {
	it("combines the sender clauses with Or and carries no anchor", () => {
		const draft = buildSenderFallbackDraft(
			["npm@github.com", "a@x.com"],
			["Deploy failed", "Standup notes"],
		);
		assert.equal(draft.matchOperator, "Or");
		assert.equal(draft.anchorMessageId, undefined);
		assert.deepEqual(draft.literalClauses, [
			{ field: "From", value: "npm@github.com" },
			{ field: "From", value: "a@x.com" },
		]);
	});

	it("carries a single FromDomain clause when the senders share a domain", () => {
		const draft = buildSenderFallbackDraft(
			["npm@github.com", "ci@github.com"],
			["Deploy failed", "Standup notes"],
		);
		assert.equal(draft.matchOperator, "Or");
		assert.deepEqual(draft.literalClauses, [
			{ field: "FromDomain", value: "github.com" },
		]);
	});

	it("falls back to a shared subject when mixed senders share no domain (#458)", () => {
		const draft = buildSenderFallbackDraft(
			["billing@acme.test", "accounts@globex.test"],
			["Invoice 1841", "Invoice 1902"],
		);
		assert.equal(draft.matchOperator, "Or");
		assert.deepEqual(draft.literalClauses, [
			{ field: "Subject", value: "Invoice" },
		]);
	});

	it("offers one sender chip each when mixed senders share no subject either", () => {
		const draft = buildSenderFallbackDraft(
			["billing@acme.test", "accounts@globex.test"],
			["Invoice 1841", "Standup notes"],
		);
		assert.equal(draft.matchOperator, "Or");
		assert.deepEqual(draft.literalClauses, [
			{ field: "From", value: "billing@acme.test" },
			{ field: "From", value: "accounts@globex.test" },
		]);
	});
});
