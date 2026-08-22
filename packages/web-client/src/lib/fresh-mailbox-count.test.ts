/**
 * awaitFreshMailboxCount — the gate a folder delete holds behind while the
 * server is asked what the folder actually holds. It reports a count only from
 * a round that stamped past the baseline, reports `pending` rather than a count
 * when the segment runs out, and refuses outright on a folder the account does
 * not list.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	awaitFreshMailboxCount,
	FRESH_COUNT_MISSING_MESSAGE,
	type MailboxCountReading,
	mailboxSyncStamp,
} from "./fresh-mailbox-count.js";

const reading = (
	messagesTotal: number,
	lastSyncedAt?: number,
): MailboxCountReading => ({
	mailboxId: "mbx-1",
	messagesTotal,
	lastSyncedAt,
});

const noDelay = () => Promise.resolve();

/** A clock that jumps a minute per reading, so a segment expires in two polls. */
const impatientClock = () => {
	let clock = 0;
	return () => {
		clock += 60_000;
		return clock;
	};
};

describe("mailboxSyncStamp", () => {
	it("reads the folder's stamp, and zero for a folder never synced", () => {
		assert.equal(mailboxSyncStamp([reading(0, 100)], "mbx-1"), 100);
		assert.equal(mailboxSyncStamp([reading(0)], "mbx-1"), 0);
	});

	it("refuses a folder the account does not list", () => {
		assert.throws(() => mailboxSyncStamp([], "mbx-1"), {
			message: FRESH_COUNT_MISSING_MESSAGE,
		});
	});
});

describe("awaitFreshMailboxCount", () => {
	it("resolves with the count a round stamped past the baseline", async () => {
		const responses = [[reading(0, 100)], [reading(0, 100)], [reading(3, 200)]];
		let call = 0;
		const outcome = await awaitFreshMailboxCount({
			mailboxId: "mbx-1",
			since: 100,
			readMailboxes: async () => responses[call++] as MailboxCountReading[],
			delay: noDelay,
		});
		assert.deepEqual(outcome, { status: "fresh", messageCount: 3 });
		assert.equal(call, 3);
	});

	it("never reports a count from a round older than the baseline", async () => {
		// The stamp stands still — the folder was never re-read, so the zero
		// sitting in the row is exactly the stale count that must not be trusted.
		const outcome = await awaitFreshMailboxCount({
			mailboxId: "mbx-1",
			since: 100,
			readMailboxes: async () => [reading(0, 100)],
			delay: noDelay,
			now: impatientClock(),
		});
		assert.deepEqual(outcome, { status: "pending" });
	});

	it("resumes against the same baseline and then reports the count", async () => {
		let stamp = 100;
		const readMailboxes = async () => [reading(2, stamp)];
		const first = await awaitFreshMailboxCount({
			mailboxId: "mbx-1",
			since: 100,
			readMailboxes,
			delay: noDelay,
			now: impatientClock(),
		});
		assert.deepEqual(first, { status: "pending" });

		stamp = 300;
		const second = await awaitFreshMailboxCount({
			mailboxId: "mbx-1",
			since: 100,
			readMailboxes,
			delay: noDelay,
			now: impatientClock(),
		});
		assert.deepEqual(second, { status: "fresh", messageCount: 2 });
	});

	it("refuses a folder the account no longer lists", async () => {
		await assert.rejects(
			awaitFreshMailboxCount({
				mailboxId: "mbx-1",
				since: 100,
				readMailboxes: async () => [],
				delay: noDelay,
			}),
			{ message: FRESH_COUNT_MISSING_MESSAGE },
		);
	});

	it("propagates a failed read rather than counting it as zero", async () => {
		await assert.rejects(
			awaitFreshMailboxCount({
				mailboxId: "mbx-1",
				since: 100,
				readMailboxes: async () => {
					throw new Error("sync status 500");
				},
				delay: noDelay,
			}),
			{ message: "sync status 500" },
		);
	});

	it("stops on abort and never reports a count", async () => {
		const controller = new AbortController();
		let call = 0;
		controller.abort();
		await assert.rejects(
			awaitFreshMailboxCount({
				mailboxId: "mbx-1",
				since: 100,
				readMailboxes: async () => {
					call += 1;
					return [reading(0, 200)];
				},
				signal: controller.signal,
				delay: noDelay,
			}),
		);
		assert.equal(call, 0, "an aborted wait reads nothing");
	});
});
