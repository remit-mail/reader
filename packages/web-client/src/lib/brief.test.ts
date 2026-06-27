import assert from "node:assert";
import { describe, test } from "node:test";
import type { ThreadRowData } from "@remit/ui";
import { groupBriefSections, matchesBriefSearch } from "./brief.js";

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

	test("missing category falls back to personal", () => {
		const r = row({ id: "1" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "personal");
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
