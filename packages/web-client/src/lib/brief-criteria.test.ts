/**
 * What each brief section asks the server for.
 *
 * #312: every section is its own category-scoped request, so the chips and the
 * tokens that ask for the same thing have to reach it as parameters. A criterion
 * evaluated over the ten rows a section fetched would mean "among the newest ten
 * Marketing messages", which is the reading the whole issue removes.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	BRIEF_TOKEN_PARAMS,
	briefCountsMatchRows,
	briefCriteria,
} from "./brief-criteria.js";
import { parseSearchTokens, type SearchToken } from "./search-tokens.js";

const tokensOf = (query: string): SearchToken[] =>
	parseSearchTokens(query, {
		accountsByName: new Map([["alice", "acc_1"]]),
		mailboxesByName: new Map([["sent", "mb2"]]),
	}).tokens;

const criteriaOf = (
	query: string,
	attributes: string[] = [],
	accountId?: string,
) =>
	briefCriteria("all", new Set(attributes), tokensOf(query), accountId)
		.criteria;

const residualTypes = (query: string, attributes: string[] = []) =>
	briefCriteria("all", new Set(attributes), tokensOf(query)).residual.map(
		(t) => t.type,
	);

describe("briefCriteria", () => {
	// The brief renders no muted sender's mail, so every request it makes says
	// so — the alternative is a header counting mail the list drops (#1137).
	test("an unnarrowed brief still refuses muted senders", () => {
		assert.deepEqual(criteriaOf(""), { muted: false });
		assert.deepEqual(residualTypes(""), []);
	});

	test("the chips travel as parameters", () => {
		assert.deepEqual(criteriaOf("", ["unread", "attachment"]), {
			muted: false,
			unread: true,
			attachments: true,
		});
	});

	test("a typed token asks for exactly what its chip asks for", () => {
		assert.deepEqual(criteriaOf("is:unread has:attachment"), {
			muted: false,
			unread: true,
			attachments: true,
		});
		assert.deepEqual(residualTypes("is:unread has:attachment"), []);
	});

	test("is:read narrows the request rather than the rows", () => {
		assert.deepEqual(criteriaOf("is:read"), { muted: false, unread: false });
		assert.deepEqual(residualTypes("is:read"), []);
	});

	test("is:starred travels too", () => {
		assert.deepEqual(criteriaOf("is:starred"), { muted: false, starred: true });
		assert.deepEqual(residualTypes("is:starred"), []);
	});

	// #1136: the pill used to narrow the rows after they arrived, so a count
	// taken over every account was not the size of the list showing one.
	test("the account pill travels as a parameter", () => {
		assert.deepEqual(criteriaOf("", [], "acc_1"), {
			muted: false,
			accountId: "acc_1",
		});
	});

	test("the cross-account brief names no account", () => {
		assert.equal(Object.hasOwn(criteriaOf(""), "accountId"), false);
	});

	// The section supplies its own category, so the shared criteria must not
	// carry one — two categories on one request is a request for neither.
	test("the category never travels in the shared criteria", () => {
		assert.deepEqual(criteriaOf("category:personal"), { muted: false });
		assert.deepEqual(criteriaOf("", ["unread"]), {
			muted: false,
			unread: true,
		});
		assert.equal(
			Object.hasOwn(
				briefCriteria("personal", new Set(), []).criteria,
				"category",
			),
			false,
		);
	});

	// #1128: the free-text parameter matches subject and From at once, so
	// neither token could be asked for on its own and both were applied over the
	// rows a section had fetched. Each has its own parameter now.
	test("from: and subject: travel as parameters", () => {
		assert.deepEqual(criteriaOf("from:alice"), {
			muted: false,
			from: "alice",
		});
		assert.deepEqual(residualTypes("from:alice"), []);
		assert.deepEqual(criteriaOf("subject:invoice"), {
			muted: false,
			subject: "invoice",
		});
		assert.deepEqual(residualTypes("subject:invoice"), []);
		assert.equal(BRIEF_TOKEN_PARAMS.includes("from"), true);
		assert.equal(BRIEF_TOKEN_PARAMS.includes("subject"), true);
	});

	// One parameter per field, so a second value cannot be expressed; it drops
	// to the residue rather than being silently lost.
	test("a second from: stays residue", () => {
		assert.deepEqual(criteriaOf("from:alice from:bob"), {
			muted: false,
			from: "alice",
		});
		assert.deepEqual(residualTypes("from:alice from:bob"), ["from"]);
	});

	test("dates, the mailbox and the account stay residue", () => {
		assert.deepEqual(residualTypes("before:2024-01-01 in:sent account:alice"), [
			"before",
			"in",
			"account",
		]);
	});

	test("a chip beats the token that contradicts it", () => {
		assert.deepEqual(criteriaOf("is:read", ["unread"]), {
			muted: false,
			unread: true,
		});
		assert.deepEqual(residualTypes("is:read", ["unread"]), ["isRead"]);
	});
});

describe("briefCountsMatchRows", () => {
	const reach = (over: Partial<Parameters<typeof briefCountsMatchRows>[0]>) =>
		briefCountsMatchRows({
			residual: [],
			attributes: new Set<string>(),
			...over,
		});

	test("a request carrying every criterion on screen counts what it shows", () => {
		assert.equal(reach({}), true);
		assert.equal(reach({ attributes: new Set(["unread"]) }), true);
	});

	test("a residual token makes the count wider than the list", () => {
		assert.equal(reach({ residual: tokensOf("before:2024-01-01") }), false);
	});

	test("a chip with no parameter makes the count wider than the list", () => {
		assert.equal(reach({ attributes: new Set(["contacts"]) }), false);
		assert.equal(reach({ attributes: new Set(["today"]) }), false);
	});
});
