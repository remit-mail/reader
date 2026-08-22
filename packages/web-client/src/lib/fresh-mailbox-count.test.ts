/**
 * waitForFreshMailboxCount — the gate a folder delete holds behind while the
 * server is asked what the folder actually holds. It resolves only on a count
 * a sync round read after the trigger, and rejects on everything else: a
 * folder that is not listed, a round that never lands, an aborted wait.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	FRESH_COUNT_MISSING_MESSAGE,
	FRESH_COUNT_TIMEOUT_MESSAGE,
	type MailboxCountReading,
	waitForFreshMailboxCount,
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

describe("waitForFreshMailboxCount", () => {
	it("resolves with the count a round stamped after the trigger", async () => {
		const responses = [[reading(0, 100)], [reading(0, 100)], [reading(3, 200)]];
		let call = 0;
		let triggered = 0;
		const count = await waitForFreshMailboxCount({
			mailboxId: "mbx-1",
			readMailboxes: async () => responses[call++] as MailboxCountReading[],
			triggerSync: async () => {
				triggered += 1;
			},
			delay: noDelay,
		});
		assert.equal(count, 3);
		assert.equal(triggered, 1, "the round is asked for once");
		assert.equal(call, 3, "the baseline read, then two polls");
	});

	it("never reads a count from a round older than the trigger", async () => {
		// The stamp stands still — the folder was never re-read, so the zero
		// sitting in the row is exactly the stale count that must not be trusted.
		await assert.rejects(
			waitForFreshMailboxCount({
				mailboxId: "mbx-1",
				readMailboxes: async () => [reading(0, 100)],
				triggerSync: async () => undefined,
				delay: noDelay,
				now: (() => {
					let clock = 0;
					return () => {
						clock += 30_000;
						return clock;
					};
				})(),
			}),
			{ message: FRESH_COUNT_TIMEOUT_MESSAGE },
		);
	});

	it("refuses a folder the account does not list", async () => {
		await assert.rejects(
			waitForFreshMailboxCount({
				mailboxId: "mbx-1",
				readMailboxes: async () => [],
				triggerSync: async () => undefined,
				delay: noDelay,
			}),
			{ message: FRESH_COUNT_MISSING_MESSAGE },
		);
	});

	it("propagates a failed read rather than counting it as zero", async () => {
		await assert.rejects(
			waitForFreshMailboxCount({
				mailboxId: "mbx-1",
				readMailboxes: async () => {
					throw new Error("sync status 500");
				},
				triggerSync: async () => undefined,
				delay: noDelay,
			}),
			{ message: "sync status 500" },
		);
	});

	it("propagates a failed trigger", async () => {
		await assert.rejects(
			waitForFreshMailboxCount({
				mailboxId: "mbx-1",
				readMailboxes: async () => [reading(0, 100)],
				triggerSync: async () => {
					throw new Error("queue unreachable");
				},
				delay: noDelay,
			}),
			{ message: "queue unreachable" },
		);
	});

	it("stops on abort and never reports a count", async () => {
		const controller = new AbortController();
		let call = 0;
		let triggered = 0;
		await assert.rejects(
			waitForFreshMailboxCount({
				mailboxId: "mbx-1",
				readMailboxes: async () => {
					call += 1;
					controller.abort();
					return [reading(0, 100)];
				},
				triggerSync: async () => {
					triggered += 1;
				},
				signal: controller.signal,
				delay: noDelay,
			}),
		);
		assert.equal(call, 1, "the abort lands before the poll reads again");
		assert.equal(triggered, 0, "an aborted wait asks for no round");
	});
});
