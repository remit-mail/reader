import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	categoryLabels,
	type ResultCount,
	type ThreadCategory,
	type ThreadRowData,
} from "@remit/ui";
import {
	BRIEF_CATEGORIES,
	type BriefCategoryResult,
	briefSections,
	matchesSearchTokens,
	toThreadRowData,
} from "./brief.js";
import type { SearchToken } from "./search-tokens.js";

function threadResponse(
	overrides: Partial<RemitImapThreadMessageResponse> = {},
): RemitImapThreadMessageResponse {
	return {
		threadId: "t1",
		threadMessageId: "tm1",
		messageId: "m1",
		accountConfigId: "cfg_1",
		mailboxId: "mb1",
		fromName: "Sender",
		fromEmail: "sender@example.com",
		subject: "Subject",
		snippet: "Snippet",
		category: "uncategorized",
		sentDate: 1767225600,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
		star: "none",
		senderTrust: "unknown",
		status: "active",
		syncStatus: "pending",
		abandonedMutation: "none",
		muted: false,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function row(
	overrides: Partial<ThreadRowData> & Pick<ThreadRowData, "id">,
): ThreadRowData {
	return {
		accountId: "acc_1",
		fromName: "Sender",
		fromEmail: "sender@example.com",
		subject: "Subject",
		snippet: "Snippet",
		timeLabel: "09:00",
		isRead: false,
		hasAttachment: false,
		starred: false,
		...overrides,
	};
}

describe("toThreadRowData", () => {
	// `star` is a colour, and it defaults to the "none" sentinel — starring a
	// message only flips `hasStars`. Reading the colour to decide starredness
	// made every row unstarred and left the Starred mailbox permanently empty.
	test("a message with hasStars and the default star colour is starred", () => {
		const row = toThreadRowData(
			threadResponse({ hasStars: true, star: "none" }),
		);
		assert.strictEqual(row.starred, true);
	});

	test("a message with a star colour is starred", () => {
		const row = toThreadRowData(
			threadResponse({ hasStars: true, star: "yellow" }),
		);
		assert.strictEqual(row.starred, true);
	});

	test("a message without hasStars is not starred", () => {
		const row = toThreadRowData(
			threadResponse({ hasStars: false, star: "yellow" }),
		);
		assert.strictEqual(row.starred, false);
	});
});

describe("briefSections", () => {
	const result = (
		category: ThreadCategory,
		rows: ThreadRowData[],
		total: ResultCount = { kind: "exact", value: rows.length },
		loading = false,
		failed = false,
		atCap = false,
	): BriefCategoryResult => ({
		category,
		rows,
		total,
		atCap,
		loading,
		failed,
	});

	test("returns no sections when the brief asked for nothing", () => {
		assert.deepStrictEqual(briefSections([]), []);
	});

	test("each category answers for its own section, with its own label", () => {
		for (const category of BRIEF_CATEGORIES) {
			const label = categoryLabels[category];
			const sections = briefSections([
				result(category, [row({ id: "1", category })]),
			]);
			assert.strictEqual(sections.length, 1);
			assert.strictEqual(sections[0].id, category);
			assert.strictEqual(sections[0].label, label);
		}
	});

	// The reading #312 fixes: on a mailbox whose Marketing mail is all older than
	// the newest unified page, the section held nothing and its header read zero.
	// Its own request answers over the whole scope, so it has both.
	test("a category renders its rows and its real size, page order aside", () => {
		const sections = briefSections([
			result("marketing", [row({ id: "old-1" }), row({ id: "old-2" })], {
				kind: "exact",
				value: 3942,
			}),
		]);
		assert.deepStrictEqual(
			sections[0].threads.map((t) => t.id),
			["old-1", "old-2"],
		);
		assert.deepStrictEqual(sections[0].total, { kind: "exact", value: 3942 });
	});

	test("the total is the server's, never the number of rows loaded", () => {
		const sections = briefSections([
			result("personal", [row({ id: "1" })], { kind: "exact", value: 4753 }),
		]);
		assert.deepStrictEqual(sections[0].total, { kind: "exact", value: 4753 });
	});

	test("a category the scope holds none of has no section", () => {
		assert.deepStrictEqual(briefSections([result("social", [])]), []);
	});

	test("a category still being fetched keeps its section", () => {
		const sections = briefSections([
			result("social", [], { kind: "exact", value: 88 }, true),
		]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].loading, true);
	});

	// Seven requests are seven answers. One category's failure states itself where
	// that category would have been; it does not take the other six down.
	test("a category whose own request failed keeps its section", () => {
		const sections = briefSections([
			result("marketing", [], { kind: "unknown" }, false, true),
			result("personal", [row({ id: "1", category: "personal" })]),
		]);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			["personal", "marketing"],
		);
		assert.strictEqual(sections.find((s) => s.id === "marketing")?.error, true);
	});

	// The count is withheld whenever something narrows rows after they arrive, and
	// a full page is then the only thing that says the category holds more. Losing
	// it would leave the section with no number and no way out (#312).
	test("carries the full-page flag through to the section", () => {
		const sections = briefSections([
			result(
				"marketing",
				[row({ id: "1" })],
				{ kind: "unknown" },
				false,
				false,
				true,
			),
		]);
		assert.strictEqual(sections[0].atCap, true);
	});

	test("a counted category with no rows left keeps its section", () => {
		const sections = briefSections([
			result("personal", [], { kind: "exact", value: 4753 }),
		]);
		assert.strictEqual(sections.length, 1);
		assert.deepStrictEqual(sections[0].threads, []);
	});

	test("an uncounted category with no rows has nothing to render", () => {
		assert.deepStrictEqual(
			briefSections([result("personal", [], { kind: "unknown" })]),
			[],
		);
	});

	// --- Row markers do not move a row out of its category ---

	test("read and unread rows share their category's section", () => {
		const sections = briefSections([
			result("personal", [
				row({ id: "1", isRead: false, category: "personal" }),
				row({ id: "2", isRead: true, category: "personal" }),
			]),
		]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].threads.length, 2);
	});

	test("starred mail never produces a flagged section", () => {
		const sections = briefSections([
			result("personal", [row({ id: "p", category: "personal" })]),
			result("automated", [
				row({ id: "f", starred: true, category: "automated" }),
			]),
		]);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			["personal", "automated"],
		);
	});

	// --- Section order and omission ---

	test("display order is fixed, Unclassified last", () => {
		const seeded: ThreadCategory[] = [
			"automated",
			"social",
			"marketing",
			"newsletter",
			"transactional",
			"personal",
			"uncategorized",
		];
		const sections = briefSections(
			seeded.map((category) =>
				result(category, [row({ id: category, category })]),
			),
		);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			[
				"personal",
				"transactional",
				"newsletter",
				"marketing",
				"social",
				"automated",
				"uncategorized",
			],
		);
	});

	// D6 / issue #45: unclassified mail is work the classifier has not done, and
	// hiding it inside Personal is what made #45 look like a working classifier
	// with a huge personal inbox.
	test("uncategorized is its own section and never inflates personal", () => {
		const sections = briefSections([
			result("personal", [row({ id: "1", category: "personal" })]),
			result("uncategorized", [
				row({ id: "2", category: "uncategorized" }),
				row({ id: "3", category: "uncategorized" }),
			]),
		]);
		assert.strictEqual(
			sections.find((s) => s.id === "personal")?.threads.length,
			1,
		);
		assert.strictEqual(
			sections.find((s) => s.id === "uncategorized")?.threads.length,
			2,
		);
	});
});

describe("matchesSearchTokens", () => {
	const from = (value: string): SearchToken => ({
		type: "from",
		raw: `from:${value}`,
		value,
	});
	const hasAttachment: SearchToken = {
		type: "hasAttachment",
		raw: "has:attachment",
	};
	const isUnread: SearchToken = { type: "isUnread", raw: "is:unread" };
	const after = (epochSeconds: number): SearchToken => ({
		type: "after",
		raw: "after:x",
		value: "x",
		epochSeconds,
	});
	const before = (epochSeconds: number): SearchToken => ({
		type: "before",
		raw: "before:x",
		value: "x",
		epochSeconds,
	});

	test("returns true with no tokens", () => {
		assert.strictEqual(matchesSearchTokens(row({ id: "1" }), []), true);
	});

	test("from: matches fromEmail or fromName, case-insensitively", () => {
		const r = row({ id: "1", fromEmail: "alice@dhl.com", fromName: "DHL" });
		assert.strictEqual(matchesSearchTokens(r, [from("DHL")]), true);
		assert.strictEqual(matchesSearchTokens(r, [from("alice@dhl")]), true);
		assert.strictEqual(matchesSearchTokens(r, [from("ups")]), false);
	});

	test("has:attachment requires hasAttachment true", () => {
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1", hasAttachment: true }), [
				hasAttachment,
			]),
			true,
		);
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1", hasAttachment: false }), [
				hasAttachment,
			]),
			false,
		);
	});

	test("is:unread requires isRead falsy", () => {
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1", isRead: false }), [isUnread]),
			true,
		);
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1", isRead: true }), [isUnread]),
			false,
		);
	});

	test("is:read requires isRead true", () => {
		const isRead: SearchToken = { type: "isRead", raw: "is:read" };
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1", isRead: true }), [isRead]),
			true,
		);
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1", isRead: false }), [isRead]),
			false,
		);
	});

	test("is:starred requires starred true", () => {
		const isStarred: SearchToken = { type: "isStarred", raw: "is:starred" };
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1", starred: true }), [isStarred]),
			true,
		);
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1" }), [isStarred]),
			false,
		);
	});

	test("subject: matches the subject, case-insensitively", () => {
		const subject: SearchToken = {
			type: "subject",
			raw: "subject:roadmap",
			value: "RoadMap",
		};
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1", subject: "Q3 roadmap" }), [subject]),
			true,
		);
		assert.strictEqual(
			matchesSearchTokens(row({ id: "2", subject: "Invoice" }), [subject]),
			false,
		);
	});

	test("category: matches the row's category, unclassified included", () => {
		const personal: SearchToken = {
			type: "category",
			raw: "category:personal",
			value: "personal",
			category: "personal",
		};
		const unclassified: SearchToken = {
			type: "category",
			raw: "category:unclassified",
			value: "unclassified",
			category: "uncategorized",
		};
		assert.strictEqual(
			matchesSearchTokens(row({ id: "1", category: "personal" }), [personal]),
			true,
		);
		assert.strictEqual(
			matchesSearchTokens(row({ id: "2", category: "marketing" }), [personal]),
			false,
		);
		assert.strictEqual(
			matchesSearchTokens(row({ id: "3" }), [unclassified]),
			true,
		);
	});

	test("after:/before: compare against sentDate (ms)", () => {
		const jan15 = row({
			id: "1",
			sentDate: Date.parse("2024-01-15T00:00:00Z"),
		});
		assert.strictEqual(
			matchesSearchTokens(jan15, [
				after(Date.parse("2024-01-01T00:00:00Z") / 1000),
			]),
			true,
		);
		assert.strictEqual(
			matchesSearchTokens(jan15, [
				before(Date.parse("2024-01-01T00:00:00Z") / 1000),
			]),
			false,
		);
	});

	test("a date token never matches a row with no sentDate", () => {
		const r = row({ id: "1" });
		assert.strictEqual(matchesSearchTokens(r, [after(0)]), false);
		assert.strictEqual(matchesSearchTokens(r, [before(0)]), false);
	});

	test("in: matches on mailboxId", () => {
		const r = row({ id: "1", mailboxId: "mb-archive" });
		const inToken: SearchToken = {
			type: "in",
			raw: "in:archive",
			value: "archive",
			mailboxId: "mb-archive",
		};
		assert.strictEqual(matchesSearchTokens(r, [inToken]), true);
		assert.strictEqual(
			matchesSearchTokens(row({ id: "2", mailboxId: "mb-inbox" }), [inToken]),
			false,
		);
	});

	test("account: matches on accountId", () => {
		const r = row({ id: "1", accountId: "acc_work" });
		const accountToken: SearchToken = {
			type: "account",
			raw: "account:work",
			value: "work",
			accountId: "acc_work",
		};
		assert.strictEqual(matchesSearchTokens(r, [accountToken]), true);
		assert.strictEqual(
			matchesSearchTokens(row({ id: "2", accountId: "acc_personal" }), [
				accountToken,
			]),
			false,
		);
	});

	test("all tokens must match (AND)", () => {
		const r = row({
			id: "1",
			fromEmail: "alice@dhl.com",
			hasAttachment: true,
			isRead: false,
		});
		assert.strictEqual(
			matchesSearchTokens(r, [from("dhl"), hasAttachment, isUnread]),
			true,
		);
		assert.strictEqual(
			matchesSearchTokens(r, [
				from("dhl"),
				hasAttachment,
				isUnread,
				from("ups"),
			]),
			false,
		);
	});
});
