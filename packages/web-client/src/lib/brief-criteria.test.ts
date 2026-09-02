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

const criteriaOf = (query: string, attributes: string[] = []) =>
	briefCriteria("all", new Set(attributes), tokensOf(query)).criteria;

const residualTypes = (query: string, attributes: string[] = []) =>
	briefCriteria("all", new Set(attributes), tokensOf(query)).residual.map(
		(t) => t.type,
	);

describe("briefCriteria", () => {
	test("an unnarrowed brief asks for nothing in particular", () => {
		assert.deepEqual(criteriaOf(""), {});
		assert.deepEqual(residualTypes(""), []);
	});

	test("the chips travel as parameters", () => {
		assert.deepEqual(criteriaOf("", ["unread", "attachment"]), {
			unread: true,
			attachments: true,
		});
	});

	test("a typed token asks for exactly what its chip asks for", () => {
		assert.deepEqual(criteriaOf("is:unread has:attachment"), {
			unread: true,
			attachments: true,
		});
		assert.deepEqual(residualTypes("is:unread has:attachment"), []);
	});

	test("is:read narrows the request rather than the rows", () => {
		assert.deepEqual(criteriaOf("is:read"), { unread: false });
		assert.deepEqual(residualTypes("is:read"), []);
	});

	test("is:starred travels too", () => {
		assert.deepEqual(criteriaOf("is:starred"), { starred: true });
		assert.deepEqual(residualTypes("is:starred"), []);
	});

	// The section supplies its own category, so the shared criteria must not
	// carry one — two categories on one request is a request for neither.
	test("the category never travels in the shared criteria", () => {
		assert.deepEqual(criteriaOf("category:personal"), {});
		assert.deepEqual(criteriaOf("", ["unread"]), { unread: true });
		assert.equal(
			Object.hasOwn(
				briefCriteria("personal", new Set(), []).criteria,
				"category",
			),
			false,
		);
	});

	// `listAllThreads` has one text parameter matching subject and From at once,
	// so neither token can be asked for on its own and both stay residue.
	test("from: and subject: have no parameter here and come back as residue", () => {
		assert.deepEqual(criteriaOf("from:alice"), {});
		assert.deepEqual(residualTypes("from:alice"), ["from"]);
		assert.deepEqual(residualTypes("subject:invoice"), ["subject"]);
		assert.deepEqual(BRIEF_TOKEN_PARAMS.includes("from"), false);
	});

	test("dates, the mailbox and the account stay residue", () => {
		assert.deepEqual(residualTypes("before:2024-01-01 in:sent account:alice"), [
			"before",
			"in",
			"account",
		]);
	});

	test("a chip beats the token that contradicts it", () => {
		assert.deepEqual(criteriaOf("is:read", ["unread"]), { unread: true });
		assert.deepEqual(residualTypes("is:read", ["unread"]), ["isRead"]);
	});
});

describe("briefCountsMatchRows", () => {
	const reach = (over: Partial<Parameters<typeof briefCountsMatchRows>[0]>) =>
		briefCountsMatchRows({
			residual: [],
			attributes: new Set<string>(),
			accountScoped: false,
			...over,
		});

	test("a request carrying every criterion on screen counts what it shows", () => {
		assert.equal(reach({}), true);
		assert.equal(reach({ attributes: new Set(["unread"]) }), true);
	});

	test("a residual token makes the count wider than the list", () => {
		assert.equal(reach({ residual: tokensOf("from:alice") }), false);
	});

	test("the account pills scope the rows and nothing else", () => {
		assert.equal(reach({ accountScoped: true }), false);
	});

	test("a chip with no parameter makes the count wider than the list", () => {
		assert.equal(reach({ attributes: new Set(["contacts"]) }), false);
		assert.equal(reach({ attributes: new Set(["today"]) }), false);
	});
});
