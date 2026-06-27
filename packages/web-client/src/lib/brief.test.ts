import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import type { ThreadRowData } from "@remit/ui";
import {
	buildBriefChips,
	countMutedAccounts,
	groupBriefSections,
	matchesBriefSearch,
} from "./brief.js";

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

	// --- Starred wins over category ---

	test("starred newsletter goes to flagged, not newsletter", () => {
		const r = row({ id: "1", starred: true, category: "newsletter" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "flagged");
	});

	test("starred personal goes to flagged", () => {
		const r = row({ id: "1", starred: true, category: "personal" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "flagged");
	});

	test("flagged is pinned above the category sections", () => {
		const rows: ThreadRowData[] = [
			row({ id: "p", category: "personal" }),
			row({ id: "f", starred: true, category: "automated" }),
		];
		const sections = groupBriefSections(rows);
		assert.strictEqual(sections[0].id, "flagged");
		assert.strictEqual(sections[1].id, "personal");
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

	test("display order is: flagged, personal, transactional, newsletter, marketing, social, automated", () => {
		const rows: ThreadRowData[] = [
			row({ id: "auto", category: "automated" }),
			row({ id: "social", category: "social" }),
			row({ id: "mkt", category: "marketing" }),
			row({ id: "news", category: "newsletter" }),
			row({ id: "txn", category: "transactional" }),
			row({ id: "pers", category: "personal" }),
			row({ id: "flag", starred: true, category: "automated" }),
		];
		const sections = groupBriefSections(rows);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			[
				"flagged",
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

function account(
	overrides: Partial<RemitImapAccountResponse> &
		Pick<RemitImapAccountResponse, "accountId" | "email">,
): RemitImapAccountResponse {
	return {
		accountConfigId: "cfg-1",
		username: "user",
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: "authenticated",
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	} as RemitImapAccountResponse;
}

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

describe("buildBriefChips / countMutedAccounts — muted is an object flag", () => {
	// `muted` is RemitImapMutedFlag = { value: boolean, ... }, NOT a boolean.
	// An account muted-then-unmuted carries `muted: { value: false }`, which is
	// truthy as an object — these tests lock that only `value: true` counts as
	// muted, mirroring routes/settings/accounts.tsx's `account.muted?.value`.
	const personal = account({
		accountId: "acc_p",
		email: "alice@personal.test",
	});
	const work = account({ accountId: "acc_w", email: "alice@work.test" });
	const unmuted = account({
		accountId: "acc_u",
		email: "alice@unmuted.test",
		muted: { value: false } as RemitImapAccountResponse["muted"],
	});
	const muted = account({
		accountId: "acc_m",
		email: "alice@muted.test",
		muted: { value: true } as RemitImapAccountResponse["muted"],
	});

	test("an account with muted:{value:false} is NOT counted as muted", () => {
		assert.strictEqual(countMutedAccounts([personal, unmuted]), 0);
	});

	test("an account with muted:{value:true} IS counted as muted", () => {
		assert.strictEqual(countMutedAccounts([personal, muted]), 1);
	});

	test("chips include accounts with muted:{value:false}", () => {
		const chips = buildBriefChips([personal, unmuted], new Map(), undefined);
		const ids = chips.map((c) => c.id);
		assert.ok(ids.includes("acc_u"));
		assert.ok(ids.includes("acc_p"));
	});

	test("chips exclude accounts with muted:{value:true}", () => {
		const chips = buildBriefChips(
			[personal, work, muted],
			new Map(),
			undefined,
		);
		const ids = chips.map((c) => c.id);
		assert.ok(!ids.includes("acc_m"));
		// "All" + the two non-muted accounts.
		assert.strictEqual(chips.length, 3);
	});
});
