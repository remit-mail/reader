import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { InboxFilterParams } from "./inbox-filters.js";
import { parseSearchTokens, type SearchToken } from "./search-tokens.js";
import {
	applyResidualTokens,
	threadSearchTokens,
} from "./thread-search-tokens.js";

const tokensOf = (query: string): SearchToken[] =>
	parseSearchTokens(query, {
		accountsByName: new Map([["alice", "acc_1"]]),
		mailboxesByName: new Map([["sent", "mb2"]]),
	}).tokens;

const split = (query: string, chips: InboxFilterParams = {}) =>
	threadSearchTokens(tokensOf(query), chips);

const residualTypes = (query: string, chips: InboxFilterParams = {}) =>
	split(query, chips).residual.map((token) => token.type);

const thread = (
	overrides: Partial<RemitImapThreadMessageResponse> = {},
): RemitImapThreadMessageResponse => ({
	threadId: "t1",
	threadMessageId: "tm1",
	messageId: "m1",
	accountConfigId: "cfg_1",
	accountId: "acc_1",
	mailboxId: "mb1",
	fromName: "Sender",
	fromEmail: "sender@example.com",
	subject: "Subject",
	snippet: "Snippet",
	category: "uncategorized",
	sentDate: Date.parse("2026-03-01T00:00:00Z"),
	isRead: false,
	isDeleted: false,
	hasAttachment: false,
	hasStars: false,
	star: "none",
	senderTrust: "unknown",
	muted: false,
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

describe("threadSearchTokens", () => {
	test("every token the endpoint has a parameter for reaches the request", () => {
		const { params, residual } = split(
			'from:dhl subject:"invoice due" category:newsletter is:starred has:attachment',
		);
		assert.deepEqual(params, {
			from: "dhl",
			subject: "invoice due",
			category: ["newsletter"],
			starred: true,
			attachments: true,
		});
		assert.deepEqual(residual, []);
	});

	test("is:unread and is:read are the two sides of `unread`", () => {
		assert.equal(split("is:unread").params.unread, true);
		assert.equal(split("is:read").params.unread, false);
	});

	test("is:flagged is the same filter as is:starred", () => {
		assert.equal(split("is:flagged").params.starred, true);
	});

	test("a category label resolves to the enum the request carries", () => {
		assert.deepEqual(split("category:unclassified").params.category, [
			"uncategorized",
		]);
	});

	test("no tokens set no parameters", () => {
		assert.deepEqual(split("just words").params, {});
		assert.deepEqual(split("just words").residual, []);
	});
});

describe("threadSearchTokens residue", () => {
	test("dates and the account have no parameter on this endpoint", () => {
		assert.deepEqual(residualTypes("after:2026-01-01 before:2026-02-01"), [
			"after",
			"before",
		]);
		assert.deepEqual(residualTypes("account:alice"), ["account"]);
	});

	test("a mailbox term is residue where it resolves at all", () => {
		assert.deepEqual(residualTypes("in:sent"), ["in"]);
	});

	test("a second value for a single-valued parameter is residue", () => {
		const { params, residual } = split("from:dhl from:ups");
		assert.equal(params.from, "dhl");
		assert.deepEqual(
			residual.map((token) => token.raw),
			["from:ups"],
		);
		assert.deepEqual(split("subject:one subject:two").params.subject, "one");
		assert.deepEqual(residualTypes("subject:one subject:two"), ["subject"]);
		assert.deepEqual(residualTypes("category:social category:personal"), [
			"category",
		]);
	});

	test("repeating a token asks nothing new, so nothing is left over", () => {
		assert.deepEqual(residualTypes("from:dhl from:DHL"), []);
		assert.deepEqual(residualTypes("is:starred is:starred"), []);
	});

	test("contradicting state tokens cannot both be sent", () => {
		const { params, residual } = split("is:unread is:read");
		assert.equal(params.unread, true);
		assert.deepEqual(
			residual.map((token) => token.type),
			["isRead"],
		);
	});
});

describe("threadSearchTokens against the filter chips", () => {
	test("a chip that already asks for it leaves nothing over", () => {
		assert.deepEqual(residualTypes("is:starred", { starred: true }), []);
		assert.deepEqual(residualTypes("is:unread", { unread: true }), []);
		assert.deepEqual(
			residualTypes("category:personal", { category: ["personal"] }),
			[],
		);
	});

	test("the visible chip wins the parameter and the token becomes residue", () => {
		assert.deepEqual(residualTypes("is:read", { unread: true }), ["isRead"]);
		assert.deepEqual(
			residualTypes("category:social", { category: ["personal"] }),
			["category"],
		);
	});
});

describe("applyResidualTokens", () => {
	test("no residue leaves the rows untouched", () => {
		const rows = [thread()];
		assert.equal(applyResidualTokens(rows, []), rows);
	});

	test("a date the request could not carry is applied over the rows", () => {
		const rows = [
			thread({
				messageId: "old",
				sentDate: Date.parse("2026-01-01T00:00:00Z"),
			}),
			thread({
				messageId: "new",
				sentDate: Date.parse("2026-04-01T00:00:00Z"),
			}),
		];
		const { residual } = split("after:2026-02-01");
		assert.deepEqual(
			applyResidualTokens(rows, residual).map((row) => row.messageId),
			["new"],
		);
	});

	test("a contradiction the request could not express matches nothing", () => {
		const rows = [thread({ isRead: false })];
		const { residual } = split("is:unread is:read");
		assert.deepEqual(applyResidualTokens(rows, residual), []);
	});

	test("an account other than the row's drops the row", () => {
		const { residual } = split("account:alice");
		assert.equal(applyResidualTokens([thread()], residual).length, 1);
		assert.equal(
			applyResidualTokens([thread({ accountId: "acc_2" })], residual).length,
			0,
		);
	});

	test("a per-mailbox row takes the account of the view it is listed in", () => {
		const rows = [thread({ accountId: undefined })];
		const { residual } = split("account:alice");
		assert.equal(applyResidualTokens(rows, residual, "acc_1").length, 1);
		assert.equal(applyResidualTokens(rows, residual, "acc_2").length, 0);
		assert.equal(applyResidualTokens(rows, residual).length, 0);
	});
});
