import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import type { ThreadRowData } from "@remit/ui";
import {
	groupBriefSections,
	matchesBriefSearch,
	matchesSearchTokens,
	mergeSearchRows,
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
		sentDate: 1767225600,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
		star: "none",
		senderTrust: "unknown",
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

describe("groupBriefSections", () => {
	test("returns empty array when no rows", () => {
		const sections = groupBriefSections([]);
		assert.deepStrictEqual(sections, []);
	});

	// --- One section per category ---

	test("personal goes to the personal section", () => {
		const r = row({ id: "1", category: "personal" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "personal");
		assert.strictEqual(sections[0].label, "Personal");
	});

	test("transactional goes to the transactional section", () => {
		const r = row({ id: "1", category: "transactional" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "transactional");
		assert.strictEqual(sections[0].label, "Transactional");
	});

	test("newsletter goes to the newsletter section", () => {
		const r = row({ id: "1", category: "newsletter" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "newsletter");
		assert.strictEqual(sections[0].label, "Newsletter");
	});

	test("marketing goes to the marketing section", () => {
		const r = row({ id: "1", category: "marketing" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "marketing");
		assert.strictEqual(sections[0].label, "Marketing");
	});

	test("social goes to the social section", () => {
		const r = row({ id: "1", category: "social" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "social");
		assert.strictEqual(sections[0].label, "Social");
	});

	test("automated goes to the automated section", () => {
		const r = row({ id: "1", category: "automated" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "automated");
		assert.strictEqual(sections[0].label, "Automated");
	});

	// --- Read state is not a routing signal ---

	test("read and unread rows of a category share one section", () => {
		const rows: ThreadRowData[] = [
			row({ id: "1", isRead: false, category: "personal" }),
			row({ id: "2", isRead: true, category: "personal" }),
		];
		const sections = groupBriefSections(rows);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "personal");
		assert.strictEqual(sections[0].threads.length, 2);
	});

	// --- Fallback to personal ---

	test("missing category lands in its own Unclassified section", () => {
		// Never folded into Personal: unclassified mail is work the classifier
		// has not done, and hiding it inside Personal is what made issue #45
		// look like a working classifier with a huge personal inbox.
		const r = row({ id: "1" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "uncategorized");
	});

	test("uncategorized rows do not inflate the personal section", () => {
		const sections = groupBriefSections([
			row({ id: "1", category: "personal" }),
			row({ id: "2", category: "uncategorized" }),
			row({ id: "3", category: "uncategorized" }),
		]);
		const personal = sections.find((s) => s.id === "personal");
		const unclassified = sections.find((s) => s.id === "uncategorized");
		assert.strictEqual(personal?.threads.length, 1);
		assert.strictEqual(unclassified?.threads.length, 2);
	});

	// --- Starred is a row marker, not a section (Flagged lives in the nav) ---

	test("a starred newsletter stays in the newsletter section", () => {
		const r = row({ id: "1", starred: true, category: "newsletter" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "newsletter");
	});

	test("a starred personal message stays in the personal section", () => {
		const r = row({ id: "1", starred: true, category: "personal" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "personal");
	});

	test("starred mail never produces a flagged section", () => {
		const rows: ThreadRowData[] = [
			row({ id: "p", category: "personal" }),
			row({ id: "f", starred: true, category: "automated" }),
		];
		const sections = groupBriefSections(rows);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			["personal", "automated"],
		);
	});

	// --- Trust no longer sections ---

	test("a vip newsletter stays in the newsletter section (trust does not section)", () => {
		const r = row({ id: "1", trust: "vip", category: "newsletter" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "newsletter");
	});

	test("a wellknown automated row stays in the automated section", () => {
		const r = row({ id: "1", trust: "wellknown", category: "automated" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "automated");
	});

	// --- Section order and omission ---

	test("display order is: personal, transactional, newsletter, marketing, social, automated", () => {
		const rows: ThreadRowData[] = [
			row({ id: "auto", category: "automated" }),
			row({ id: "social", category: "social" }),
			row({ id: "mkt", category: "marketing" }),
			row({ id: "news", category: "newsletter" }),
			row({ id: "txn", category: "transactional" }),
			row({ id: "pers", category: "personal" }),
			row({ id: "star", starred: true, category: "automated" }),
		];
		const sections = groupBriefSections(rows);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			[
				"personal",
				"transactional",
				"newsletter",
				"marketing",
				"social",
				"automated",
			],
		);
	});

	test("empty sections are omitted", () => {
		const sections = groupBriefSections([row({ id: "1", category: "social" })]);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			["social"],
		);
	});

	test("each row appears in exactly one section", () => {
		const rows: ThreadRowData[] = [
			row({ id: "1", category: "personal" }),
			row({ id: "2", starred: true, category: "automated" }),
			row({ id: "3", category: "automated" }),
			row({ id: "4", category: "transactional" }),
			row({ id: "5", starred: true, category: "newsletter" }),
			row({ id: "6", category: "newsletter" }),
			row({ id: "7", category: "marketing" }),
		];
		const sections = groupBriefSections(rows);
		const allIds = sections.flatMap((s) => s.threads.map((t) => t.id));
		assert.strictEqual(allIds.length, rows.length);
		const uniqueIds = new Set(allIds);
		assert.strictEqual(uniqueIds.size, rows.length);
	});
});

describe("matchesBriefSearch", () => {
	const r = row({
		id: "1",
		fromName: "Alice Tan",
		fromEmail: "alice@example.com",
		subject: "Q3 roadmap",
		snippet: "See the attached deck",
	});

	test("matches on fromName (case-insensitive)", () => {
		assert.strictEqual(matchesBriefSearch(r, "alice"), true);
	});

	test("matches on fromEmail", () => {
		assert.strictEqual(matchesBriefSearch(r, "alice@example"), true);
	});

	test("matches on subject", () => {
		assert.strictEqual(matchesBriefSearch(r, "roadmap"), true);
	});

	test("matches on snippet", () => {
		assert.strictEqual(matchesBriefSearch(r, "deck"), true);
	});

	test("returns false when query matches nothing", () => {
		assert.strictEqual(matchesBriefSearch(r, "zyxwvuts"), false);
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

// #49: the brief's list is the unified INBOX, so filtering it client-side found
// only inbox mail. The server's cross-folder search supplies the rest, and the
// two are merged.
describe("mergeSearchRows", () => {
	test("keeps rows the server found in other folders", () => {
		const merged = mergeSearchRows(
			[row({ id: "inbox-hit", sentDate: 300 })],
			[
				row({ id: "archive-hit", sentDate: 200 }),
				row({ id: "spam-hit", sentDate: 100 }),
			],
		);

		assert.deepEqual(
			merged.map((r) => r.id),
			["inbox-hit", "archive-hit", "spam-hit"],
		);
	});

	test("keeps a snippet-only match the server cannot see", () => {
		const merged = mergeSearchRows(
			[row({ id: "snippet-only", sentDate: 100 })],
			[],
		);

		assert.deepEqual(
			merged.map((r) => r.id),
			["snippet-only"],
		);
	});

	test("the two sources overlap on INBOX, so rows are deduped", () => {
		const merged = mergeSearchRows(
			[row({ id: "shared", sentDate: 200, subject: "from the brief" })],
			[
				row({ id: "shared", sentDate: 200, subject: "from the search" }),
				row({ id: "archive-hit", sentDate: 100 }),
			],
		);

		assert.deepEqual(
			merged.map((r) => r.id),
			["shared", "archive-hit"],
		);
		assert.equal(merged[0].subject, "from the brief");
	});

	test("the union reads newest first, interleaving both sources", () => {
		const merged = mergeSearchRows(
			[
				row({ id: "brief-new", sentDate: 400 }),
				row({ id: "brief-old", sentDate: 200 }),
			],
			[
				row({ id: "search-mid", sentDate: 300 }),
				row({ id: "search-oldest", sentDate: 100 }),
			],
		);

		assert.deepEqual(
			merged.map((r) => r.id),
			["brief-new", "search-mid", "brief-old", "search-oldest"],
		);
	});

	test("a row without a sentDate sorts last", () => {
		const merged = mergeSearchRows(
			[row({ id: "undated" })],
			[row({ id: "dated", sentDate: 100 })],
		);

		assert.deepEqual(
			merged.map((r) => r.id),
			["dated", "undated"],
		);
	});
});
