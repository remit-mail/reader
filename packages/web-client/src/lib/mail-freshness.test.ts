import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapMailboxSyncProgress } from "@remit/api-http-client/types.gen.ts";
import type { NavMailboxRole } from "@remit/ui";
import type { ResultFolderIndex } from "@/lib/result-folder";
import { hasGrown, totalsFrom } from "./mail-freshness.js";

const mailbox = (
	mailboxId: string,
	messagesTotal: number,
): RemitImapMailboxSyncProgress => ({
	mailboxId,
	fullPath: mailboxId,
	phase: "complete",
	messagesTotal,
	messagesSynced: messagesTotal,
});

const roles = (
	entries: Record<string, NavMailboxRole | undefined>,
): ResultFolderIndex =>
	new Map(
		Object.entries(entries).map(([id, role]) => [id, role ? { role } : {}]),
	);

describe("hasGrown", () => {
	test("false when nothing changed", () => {
		const baseline = new Map([["mb-1", 10]]);
		const current = new Map([["mb-1", 10]]);
		assert.equal(hasGrown(baseline, current), false);
	});

	test("true when a mailbox's total increased", () => {
		const baseline = new Map([["mb-1", 10]]);
		const current = new Map([["mb-1", 11]]);
		assert.equal(hasGrown(baseline, current), true);
	});

	test("false when a mailbox's total dropped (reads, deletes) — not an arrival", () => {
		const baseline = new Map([["mb-1", 10]]);
		const current = new Map([["mb-1", 9]]);
		assert.equal(hasGrown(baseline, current), false);
	});

	test("a mailbox missing from the baseline counts from zero", () => {
		const baseline = new Map<string, number>();
		const current = new Map([["mb-1", 1]]);
		assert.equal(hasGrown(baseline, current), true);
	});

	test("a mailbox with zero new messages is not growth", () => {
		const baseline = new Map<string, number>();
		const current = new Map([["mb-1", 0]]);
		assert.equal(hasGrown(baseline, current), false);
	});

	test("one mailbox growing is enough even if others are unchanged", () => {
		const baseline = new Map([
			["mb-1", 10],
			["mb-2", 5],
		]);
		const current = new Map([
			["mb-1", 10],
			["mb-2", 6],
		]);
		assert.equal(hasGrown(baseline, current), true);
	});
});

describe("totalsFrom", () => {
	test("keeps a mailbox with no resolved role (a custom folder)", () => {
		const totals = totalsFrom([mailbox("mb-custom", 5)], roles({}));
		assert.deepEqual([...totals], [["mb-custom", 5]]);
	});

	test("keeps Inbox and Junk — both are places new mail actually arrives", () => {
		const totals = totalsFrom(
			[mailbox("mb-inbox", 5), mailbox("mb-junk", 2)],
			roles({ "mb-inbox": "inbox", "mb-junk": "junk" }),
		);
		assert.deepEqual(new Set(totals.keys()), new Set(["mb-inbox", "mb-junk"]));
	});

	for (const role of ["sent", "drafts", "trash", "archive"] as const) {
		test(`drops ${role} — its own total growing is the user's doing, not an arrival`, () => {
			const totals = totalsFrom([mailbox("mb-1", 5)], roles({ "mb-1": role }));
			assert.equal(totals.has("mb-1"), false);
		});
	}

	test("a delete (Inbox shrinks, Trash grows) never reads as growth once Trash is excluded", () => {
		const folders = roles({ "mb-inbox": "inbox", "mb-trash": "trash" });
		const baseline = totalsFrom(
			[mailbox("mb-inbox", 10), mailbox("mb-trash", 3)],
			folders,
		);
		const afterDelete = totalsFrom(
			[mailbox("mb-inbox", 9), mailbox("mb-trash", 4)],
			folders,
		);
		assert.equal(hasGrown(baseline, afterDelete), false);
	});

	test("real new mail in Inbox still reads as growth alongside an unrelated delete", () => {
		const folders = roles({ "mb-inbox": "inbox", "mb-trash": "trash" });
		const baseline = totalsFrom(
			[mailbox("mb-inbox", 10), mailbox("mb-trash", 3)],
			folders,
		);
		const afterArrivalAndDelete = totalsFrom(
			[mailbox("mb-inbox", 11), mailbox("mb-trash", 4)],
			folders,
		);
		assert.equal(hasGrown(baseline, afterArrivalAndDelete), true);
	});
});
