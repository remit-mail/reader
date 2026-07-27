import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	filterReach,
	hasInboxFilter,
	type InboxFilterCriteria,
	inboxFilterParams,
	sameInboxFilter,
} from "./inbox-filters.js";

const criteria = (
	category: string,
	attributes: string[] = [],
): InboxFilterCriteria => ({ category, attributes: new Set(attributes) });

/** The shape `threadOperationsSearchThreadsQueryKey` produces. */
const key = (query: Record<string, unknown>): unknown => [
	{ _id: "threadOperationsSearchThreads", path: { mailboxId: "mb1" }, query },
];

describe("hasInboxFilter", () => {
	test("an untouched chip row narrows nothing", () => {
		assert.equal(hasInboxFilter(criteria("all")), false);
	});

	test("a category or an attribute is a filter", () => {
		assert.equal(hasInboxFilter(criteria("personal")), true);
		assert.equal(hasInboxFilter(criteria("all", ["unread"])), true);
	});

	test("an id that names no category narrows nothing", () => {
		assert.equal(hasInboxFilter(criteria("nonsense")), false);
	});
});

describe("inboxFilterParams", () => {
	test("sends the category to the server instead of filtering here (#306)", () => {
		assert.deepEqual(inboxFilterParams(criteria("personal")), {
			category: ["personal"],
		});
	});

	test("asks for unclassified mail by name, never as absence (#45)", () => {
		assert.deepEqual(inboxFilterParams(criteria("uncategorized")), {
			category: ["uncategorized"],
		});
	});

	test("sets no category parameter for `all`", () => {
		assert.deepEqual(inboxFilterParams(criteria("all")), {});
	});

	test("maps each attribute chip onto the parameter the API names", () => {
		assert.deepEqual(
			inboxFilterParams(criteria("all", ["unread", "flagged", "attachment"])),
			{ unread: true, starred: true, attachments: true },
		);
	});

	test("carries a category and its attributes together", () => {
		assert.deepEqual(inboxFilterParams(criteria("social", ["unread"])), {
			category: ["social"],
			unread: true,
		});
	});

	test("ignores an attribute id with no parameter behind it", () => {
		assert.deepEqual(inboxFilterParams(criteria("all", ["nonsense"])), {});
	});
});

describe("filterReach", () => {
	test("a category is a column on the row, so the whole folder was read", () => {
		assert.equal(
			filterReach({ category: ["personal"], unread: true }),
			"whole-folder",
		);
	});

	test("an unfiltered request still reaches the whole folder", () => {
		assert.equal(filterReach({ order: "desc" }), "whole-folder");
	});

	test("an off-row criterion bounds the read, whatever else is set", () => {
		assert.equal(
			filterReach({ category: ["personal"], senderTrust: ["unknown"] }),
			"loaded-pages",
		);
		assert.equal(filterReach({ dkimMismatch: true }), "loaded-pages");
		assert.equal(filterReach({ dkimMismatch: false }), "loaded-pages");
	});

	test("an empty trust list bounds nothing", () => {
		assert.equal(filterReach({ senderTrust: [] }), "whole-folder");
	});
});

describe("sameInboxFilter", () => {
	test("holds across a query the user is still typing", () => {
		assert.equal(
			sameInboxFilter(key({ query: "inv", category: ["personal"] }), {
				category: ["personal"],
			}),
			true,
		);
	});

	test("fails the moment the category changes", () => {
		assert.equal(
			sameInboxFilter(key({ category: ["personal"] }), {
				category: ["social"],
			}),
			false,
		);
	});

	test("fails when a chip is cleared", () => {
		assert.equal(sameInboxFilter(key({ category: ["personal"] }), {}), false);
		assert.equal(
			sameInboxFilter(key({ unread: true }), { category: ["personal"] }),
			false,
		);
	});

	test("holds between the unfiltered listing and an unfiltered search", () => {
		assert.equal(sameInboxFilter(key({ order: "desc" }), {}), true);
	});

	test("answers false for a key it cannot read", () => {
		assert.equal(sameInboxFilter(undefined, {}), false);
		assert.equal(sameInboxFilter([], {}), false);
		assert.equal(sameInboxFilter([{ path: { mailboxId: "mb1" } }], {}), false);
	});
});
