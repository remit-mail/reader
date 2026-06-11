import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import type { ThreadRowData } from "@remit/ui";
import {
	buildBriefChips,
	countMutedAccounts,
	groupBriefSections,
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

	test("puts unread vip into needs-attention", () => {
		const r = row({ id: "1", isRead: false, trust: "vip" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "attention");
		assert.strictEqual(sections[0].threads.length, 1);
	});

	test("puts unread wellknown into needs-attention", () => {
		const r = row({ id: "1", isRead: false, trust: "wellknown" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("read vip does NOT go into attention (goes to rest)", () => {
		const r = row({ id: "1", isRead: true, trust: "vip" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "rest");
	});

	test("starred non-vip row goes to flagged", () => {
		const r = row({ id: "1", starred: true, isRead: true, trust: "unknown" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "flagged");
	});

	test("starred vip row goes to attention, not flagged", () => {
		const r = row({ id: "1", starred: true, isRead: false, trust: "vip" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "attention");
	});

	test("plain unread unknown goes to rest", () => {
		const r = row({ id: "1", isRead: false, trust: "unknown" });
		const sections = groupBriefSections([r]);
		assert.strictEqual(sections.length, 1);
		assert.strictEqual(sections[0].id, "rest");
	});

	test("three-section split: attention, flagged, rest", () => {
		const attn = row({ id: "a", isRead: false, trust: "vip" });
		const flag = row({ id: "b", starred: true, isRead: true });
		const plain = row({ id: "c", isRead: false });
		const sections = groupBriefSections([attn, flag, plain]);
		assert.strictEqual(sections.length, 3);
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			["attention", "flagged", "rest"],
		);
	});

	test("sections with no rows are omitted", () => {
		const flag = row({ id: "b", starred: true, isRead: true });
		const sections = groupBriefSections([flag]);
		// Only flagged; attention and rest are absent.
		assert.deepStrictEqual(
			sections.map((s) => s.id),
			["flagged"],
		);
	});

	test("each row appears in exactly one section", () => {
		const rows: ThreadRowData[] = [
			row({ id: "1", isRead: false, trust: "vip" }),
			row({ id: "2", starred: true, isRead: true }),
			row({ id: "3", isRead: true }),
			row({ id: "4", isRead: false }),
			row({ id: "5", isRead: false, trust: "wellknown", starred: true }),
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
			row({ id: "b", starred: true, isRead: true }),
			row({ id: "c", isRead: true }),
		];
		const sections = groupBriefSections(rows);
		const labels = sections.map((s) => s.label);
		assert.deepStrictEqual(labels, [
			"Needs attention",
			"Flagged",
			"Everything else",
		]);
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
