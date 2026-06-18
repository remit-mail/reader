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

	// --- Needs attention ---

	test("unread personal (trust unknown) goes to needs-attention", () => {
		const r = row({ id: "1", isRead: false, category: "personal" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("read personal goes to needs-attention (read state is not a routing signal)", () => {
		const r = row({ id: "1", isRead: true, category: "personal" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("unread missing-category is treated as personal → needs-attention", () => {
		const r = row({ id: "1", isRead: false });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("read missing-category is treated as personal → needs-attention", () => {
		const r = row({ id: "1", isRead: true });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("unread transactional goes to needs-attention", () => {
		const r = row({ id: "1", isRead: false, category: "transactional" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("read transactional goes to needs-attention (read state is not a routing signal)", () => {
		const r = row({ id: "1", isRead: true, category: "transactional" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("unread vip goes to needs-attention regardless of category", () => {
		// vip trust overrides — even automated mail from a VIP is surfaced
		const r = row({ id: "1", isRead: false, trust: "vip" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("read vip goes to needs-attention (trust overrides read state)", () => {
		const r = row({ id: "1", isRead: true, trust: "vip" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("unread wellknown goes to needs-attention", () => {
		const r = row({ id: "1", isRead: false, trust: "wellknown" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "attention");
	});

	// --- Daily brief (newsletter/marketing/social) ---

	test("newsletter goes to daily brief, not everything-else", () => {
		const r = row({ id: "1", isRead: false, category: "newsletter" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "brief");
		assert.strictEqual(sections[0].label, "Daily brief");
	});

	test("marketing goes to daily brief", () => {
		const r = row({ id: "1", category: "marketing" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "brief");
	});

	test("social goes to daily brief", () => {
		const r = row({ id: "1", category: "social" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "brief");
	});

	test("trusted newsletter (wellknown) still goes to daily brief — category wins over trust", () => {
		// The key new behaviour: wellknown volume-promoted newsletter senders no
		// longer surface in "Needs attention". The digest check runs before trust.
		const r = row({
			id: "1",
			isRead: false,
			trust: "wellknown",
			category: "newsletter",
		});
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "brief");
	});

	// --- Flagged (starred wins everything) ---

	test("starred newsletter goes to flagged, not daily brief", () => {
		const r = row({
			id: "1",
			isRead: true,
			starred: true,
			category: "newsletter",
		});
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "flagged");
	});

	test("starred personal (trust unknown, read) goes to flagged", () => {
		const r = row({ id: "1", starred: true, isRead: true, trust: "unknown" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "flagged");
	});

	test("starred unread vip goes to flagged (starred beats trust)", () => {
		// Starred is the highest-priority bucket — even a VIP unread message
		// lands in Flagged if the user starred it.
		const r = row({ id: "1", starred: true, isRead: false, trust: "vip" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "flagged");
	});

	// --- Everything else ---

	test("automated goes to everything-else (unread)", () => {
		// automated is not a digest category and not personal/transactional
		const r = row({ id: "1", isRead: false, category: "automated" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "rest");
	});

	test("automated goes to everything-else (read)", () => {
		const r = row({ id: "1", isRead: true, category: "automated" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "rest");
	});

	// --- Section order and multi-row splits ---

	test("display order is: attention, flagged, brief, rest", () => {
		const rows: ThreadRowData[] = [
			row({ id: "a", isRead: false, trust: "vip" }),
			row({ id: "b", starred: true, isRead: true, category: "automated" }),
			row({ id: "c", category: "newsletter" }),
			row({ id: "d", isRead: true, category: "automated" }),
		];
		const sections = groupBriefSections(rows);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			["attention", "flagged", "brief", "rest"],
		);
	});

	test("sections with no rows are omitted", () => {
		const flag = row({ id: "b", starred: true, isRead: true });
		const sections = groupBriefSections([flag]);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			["flagged"],
		);
	});

	test("each row appears in exactly one section", () => {
		const rows: ThreadRowData[] = [
			row({ id: "1", isRead: false, trust: "vip" }),
			row({ id: "2", starred: true, isRead: true, category: "automated" }),
			row({ id: "3", isRead: true, category: "automated" }),
			row({ id: "4", isRead: false, category: "personal" }),
			row({ id: "5", isRead: false, trust: "wellknown", starred: true }),
			row({ id: "6", category: "newsletter" }),
			row({ id: "7", isRead: false, category: "marketing" }),
		];
		const sections = groupBriefSections(rows);
		const allIds = sections.flatMap((s) => s.threads.map((t) => t.id));
		assert.strictEqual(allIds.length, rows.length);
		const uniqueIds = new Set(allIds);
		assert.strictEqual(uniqueIds.size, rows.length);
	});

	test("section labels match spec", () => {
		const rows: ThreadRowData[] = [
			row({ id: "a", isRead: false, trust: "vip" }),
			row({ id: "b", starred: true, isRead: true, category: "automated" }),
			row({ id: "c", category: "newsletter" }),
			row({ id: "d", isRead: true, category: "automated" }),
		];
		const sections = groupBriefSections(rows);
		const labels = sections.map((s) => s.label);
		assert.deepStrictEqual(labels, [
			"Needs attention",
			"Flagged",
			"Daily brief",
			"Everything else",
		]);
	});

	test("three digest categories all land in daily brief", () => {
		const rows: ThreadRowData[] = [
			row({ id: "1", category: "newsletter" }),
			row({ id: "2", category: "marketing" }),
			row({ id: "3", category: "social" }),
		];
		const sections = groupBriefSections(rows);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "brief");
		assert.strictEqual(sections[0].threads.length, 3);
	});

	test("personal and transactional both reach attention regardless of read state", () => {
		const rows: ThreadRowData[] = [
			row({ id: "1", isRead: false, category: "personal" }),
			row({ id: "2", isRead: false, category: "transactional" }),
			row({ id: "3", isRead: true, category: "personal" }),
			row({ id: "4", isRead: true, category: "transactional" }),
		];
		const sections = groupBriefSections(rows);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "attention");
		assert.strictEqual(sections[0].threads.length, 4);
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
