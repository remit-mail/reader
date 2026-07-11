import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	parseSearchTokens,
	removeSearchToken,
	searchTokenLabel,
} from "./search-tokens.js";

describe("parseSearchTokens", () => {
	it("returns the query untouched when there are no tokens", () => {
		const result = parseSearchTokens("parcel delivery confirmation");
		assert.equal(result.freeText, "parcel delivery confirmation");
		assert.deepEqual(result.tokens, []);
	});

	it("parses from:", () => {
		const result = parseSearchTokens("invoice from:alice@example.com");
		assert.equal(result.freeText, "invoice");
		assert.deepEqual(result.tokens, [
			{
				type: "from",
				raw: "from:alice@example.com",
				value: "alice@example.com",
			},
		]);
	});

	it("parses has:attachment", () => {
		const result = parseSearchTokens("receipts has:attachment");
		assert.equal(result.freeText, "receipts");
		assert.deepEqual(result.tokens, [
			{ type: "hasAttachment", raw: "has:attachment" },
		]);
	});

	it("parses is:unread case-insensitively", () => {
		const result = parseSearchTokens("IS:UNREAD receipts");
		assert.equal(result.freeText, "receipts");
		assert.deepEqual(result.tokens, [{ type: "isUnread", raw: "IS:UNREAD" }]);
	});

	it("parses before: and after: as epoch seconds", () => {
		const result = parseSearchTokens("after:2024-01-01 before:2024-02-01 tax");
		assert.equal(result.freeText, "tax");
		assert.deepEqual(result.tokens, [
			{
				type: "after",
				raw: "after:2024-01-01",
				value: "2024-01-01",
				epochSeconds: Date.parse("2024-01-01T00:00:00Z") / 1000,
			},
			{
				type: "before",
				raw: "before:2024-02-01",
				value: "2024-02-01",
				epochSeconds: Date.parse("2024-02-01T00:00:00Z") / 1000,
			},
		]);
	});

	it("leaves a malformed date token in the free text", () => {
		const result = parseSearchTokens("before:not-a-date tax");
		assert.equal(result.freeText, "before:not-a-date tax");
		assert.deepEqual(result.tokens, []);
	});

	it("leaves in:/account: as free text with no name index", () => {
		const result = parseSearchTokens("in:archive account:work invoice");
		assert.equal(result.freeText, "in:archive account:work invoice");
		assert.deepEqual(result.tokens, []);
	});

	it("resolves in: against a supplied mailbox name index", () => {
		const result = parseSearchTokens("in:archive invoice", {
			mailboxesByName: new Map([["archive", "mailbox-1"]]),
		});
		assert.equal(result.freeText, "invoice");
		assert.deepEqual(result.tokens, [
			{
				type: "in",
				raw: "in:archive",
				value: "archive",
				mailboxId: "mailbox-1",
			},
		]);
	});

	it("resolves in: case-insensitively", () => {
		const result = parseSearchTokens("IN:Archive invoice", {
			mailboxesByName: new Map([["archive", "mailbox-1"]]),
		});
		assert.deepEqual(result.tokens, [
			{
				type: "in",
				raw: "IN:Archive",
				value: "Archive",
				mailboxId: "mailbox-1",
			},
		]);
	});

	it("leaves in: as free text when the name isn't in the index", () => {
		const result = parseSearchTokens("in:nonexistent invoice", {
			mailboxesByName: new Map([["archive", "mailbox-1"]]),
		});
		assert.equal(result.freeText, "in:nonexistent invoice");
		assert.deepEqual(result.tokens, []);
	});

	it("resolves account: against a supplied account name index", () => {
		const result = parseSearchTokens("account:work invoice", {
			accountsByName: new Map([["work", "account-1"]]),
		});
		assert.equal(result.freeText, "invoice");
		assert.deepEqual(result.tokens, [
			{
				type: "account",
				raw: "account:work",
				value: "work",
				accountId: "account-1",
			},
		]);
	});

	it("leaves account: as free text when the name isn't in the index", () => {
		const result = parseSearchTokens("account:nonexistent invoice", {
			accountsByName: new Map([["work", "account-1"]]),
		});
		assert.equal(result.freeText, "account:nonexistent invoice");
		assert.deepEqual(result.tokens, []);
	});

	it("parses multiple tokens alongside free text", () => {
		const result = parseSearchTokens(
			"parcel from:dhl.com has:attachment is:unread",
		);
		assert.equal(result.freeText, "parcel");
		assert.equal(result.tokens.length, 3);
	});

	it("ignores a bare 'from:' with no value", () => {
		const result = parseSearchTokens("from:");
		assert.equal(result.freeText, "from:");
		assert.deepEqual(result.tokens, []);
	});
});

describe("removeSearchToken", () => {
	it("removes the token's raw text and collapses whitespace", () => {
		const tokens = parseSearchTokens("parcel from:dhl.com delivery").tokens;
		const next = removeSearchToken(
			"parcel from:dhl.com delivery",
			tokens[0] as NonNullable<(typeof tokens)[0]>,
		);
		assert.equal(next, "parcel delivery");
	});

	it("is a no-op when the token isn't present", () => {
		const next = removeSearchToken("parcel delivery", {
			type: "hasAttachment",
			raw: "has:attachment",
		});
		assert.equal(next, "parcel delivery");
	});
});

describe("searchTokenLabel", () => {
	it("labels each token type in plain words", () => {
		assert.equal(
			searchTokenLabel({ type: "from", raw: "from:alice", value: "alice" }),
			"From: alice",
		);
		assert.equal(
			searchTokenLabel({ type: "hasAttachment", raw: "has:attachment" }),
			"Has attachment",
		);
		assert.equal(
			searchTokenLabel({ type: "isUnread", raw: "is:unread" }),
			"Unread",
		);
		assert.equal(
			searchTokenLabel({
				type: "before",
				raw: "before:2024-01-01",
				value: "2024-01-01",
				epochSeconds: 0,
			}),
			"Before 2024-01-01",
		);
		assert.equal(
			searchTokenLabel({
				type: "after",
				raw: "after:2024-01-01",
				value: "2024-01-01",
				epochSeconds: 0,
			}),
			"After 2024-01-01",
		);
		assert.equal(
			searchTokenLabel({
				type: "in",
				raw: "in:archive",
				value: "archive",
				mailboxId: "mailbox-1",
			}),
			"In: archive",
		);
		assert.equal(
			searchTokenLabel({
				type: "account",
				raw: "account:work",
				value: "work",
				accountId: "account-1",
			}),
			"Account: work",
		);
	});
});
