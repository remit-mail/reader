import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapMailboxSyncProgress } from "@remit/api-http-client/types.gen.ts";
import type { NavMailboxRole } from "@remit/ui";
import type { ResultFolderIndex } from "@/lib/result-folder";
import {
	grownMailboxIds,
	hasGrown,
	highWaterMarksFrom,
} from "./mail-freshness.js";

const mailbox = (
	mailboxId: string,
	messagesTotal: number,
	highWaterMarkUid: number,
): RemitImapMailboxSyncProgress => ({
	mailboxId,
	fullPath: mailboxId,
	phase: "complete",
	messagesTotal,
	messagesSynced: messagesTotal,
	highWaterMarkUid,
});

const roles = (
	entries: Record<string, NavMailboxRole | undefined>,
): ResultFolderIndex =>
	new Map(
		Object.entries(entries).map(([id, role]) => [id, role ? { role } : {}]),
	);

describe("hasGrown", () => {
	test("false when nothing changed", () => {
		const baseline = new Map([["mb-1", 100]]);
		const current = new Map([["mb-1", 100]]);
		assert.equal(hasGrown(baseline, current), false);
	});

	test("true when a mailbox took a UID above the highest one seen", () => {
		const baseline = new Map([["mb-1", 100]]);
		const current = new Map([["mb-1", 101]]);
		assert.equal(hasGrown(baseline, current), true);
	});

	test("a mailbox missing from the baseline counts from zero", () => {
		const baseline = new Map<string, number>();
		const current = new Map([["mb-1", 1]]);
		assert.equal(hasGrown(baseline, current), true);
	});

	test("a mailbox that has never taken a message is not growth", () => {
		const baseline = new Map<string, number>();
		const current = new Map([["mb-1", 0]]);
		assert.equal(hasGrown(baseline, current), false);
	});

	test("one mailbox growing is enough even if others are unchanged", () => {
		const baseline = new Map([
			["mb-1", 100],
			["mb-2", 50],
		]);
		const current = new Map([
			["mb-1", 100],
			["mb-2", 51],
		]);
		assert.equal(hasGrown(baseline, current), true);
	});
});

describe("highWaterMarksFrom", () => {
	test("keeps a mailbox with no resolved role (a custom folder)", () => {
		const marks = highWaterMarksFrom([mailbox("mb-custom", 5, 42)], roles({}));
		assert.deepEqual([...marks], [["mb-custom", 42]]);
	});

	test("keeps Inbox and Junk — both are places new mail actually arrives", () => {
		const marks = highWaterMarksFrom(
			[mailbox("mb-inbox", 5, 42), mailbox("mb-junk", 2, 7)],
			roles({ "mb-inbox": "inbox", "mb-junk": "junk" }),
		);
		assert.deepEqual(new Set(marks.keys()), new Set(["mb-inbox", "mb-junk"]));
	});

	for (const role of ["sent", "drafts", "trash", "archive"] as const) {
		test(`drops ${role} — its own new messages are the user's doing, not an arrival`, () => {
			const marks = highWaterMarksFrom(
				[mailbox("mb-1", 5, 42)],
				roles({ "mb-1": role }),
			);
			assert.equal(marks.has("mb-1"), false);
		});
	}

	test("a delete (Inbox shrinks, Trash grows) never reads as an arrival", () => {
		const folders = roles({ "mb-inbox": "inbox", "mb-trash": "trash" });
		const baseline = highWaterMarksFrom(
			[mailbox("mb-inbox", 10, 100), mailbox("mb-trash", 3, 20)],
			folders,
		);
		const afterDelete = highWaterMarksFrom(
			[mailbox("mb-inbox", 9, 100), mailbox("mb-trash", 4, 21)],
			folders,
		);
		assert.equal(hasGrown(baseline, afterDelete), false);
	});

	// Issue #771: the arrival and the departure land in the same sync round, so
	// the Inbox total nets to zero and the count-based reading saw nothing. The
	// arrival is a UID above the highest one seen, and that is what surfaces it.
	test("an arrival alongside a departure surfaces, though the total is unchanged", () => {
		const folders = roles({ "mb-inbox": "inbox", "mb-trash": "trash" });
		const baseline = highWaterMarksFrom(
			[mailbox("mb-inbox", 10, 100), mailbox("mb-trash", 3, 20)],
			folders,
		);
		const afterArrivalAndDeparture = highWaterMarksFrom(
			[mailbox("mb-inbox", 10, 101), mailbox("mb-trash", 4, 21)],
			folders,
		);
		assert.equal(hasGrown(baseline, afterArrivalAndDeparture), true);
	});

	test("real new mail in Inbox still reads as an arrival alongside an unrelated delete", () => {
		const folders = roles({ "mb-inbox": "inbox", "mb-trash": "trash" });
		const baseline = highWaterMarksFrom(
			[mailbox("mb-inbox", 10, 100), mailbox("mb-trash", 3, 20)],
			folders,
		);
		const afterArrivalAndDelete = highWaterMarksFrom(
			[mailbox("mb-inbox", 11, 101), mailbox("mb-trash", 4, 21)],
			folders,
		);
		assert.equal(hasGrown(baseline, afterArrivalAndDelete), true);
	});
});

describe("grownMailboxIds", () => {
	// The invalidation half of the same reading: which folders' listings are
	// now behind the server, so an open tab reloads exactly those.
	test("names only the mailboxes that took a higher UID", () => {
		const baseline = new Map([
			["mb-1", 100],
			["mb-2", 40],
			["mb-3", 70],
		]);
		const current = new Map([
			["mb-1", 120],
			["mb-2", 40],
			["mb-3", 70],
		]);

		assert.deepEqual(grownMailboxIds(baseline, current), ["mb-1"]);
	});

	test("counts a folder absent from the baseline from zero", () => {
		assert.deepEqual(grownMailboxIds(new Map(), new Map([["mb-new", 3]])), [
			"mb-new",
		]);
	});

	test("is empty when nothing moved", () => {
		const marks = new Map([["mb-1", 100]]);
		assert.deepEqual(grownMailboxIds(marks, new Map(marks)), []);
	});
});
