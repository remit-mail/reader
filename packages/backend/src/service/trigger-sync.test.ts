import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import {
	buildScheduledSyncDedupId,
	buildSyncMailboxesMessage,
	triggerAccountSync,
} from "./trigger-sync.js";

describe("buildSyncMailboxesMessage", () => {
	it("groups the message by accountId", () => {
		const message = buildSyncMailboxesMessage({ accountId: "account-abc" });

		assert.equal(message.groupId, "account-abc");
	});

	it("defaults the deduplication id to the event's own id", () => {
		const message = buildSyncMailboxesMessage({ accountId: "account-abc" });

		assert.equal(message.deduplicationId, message.body.eventId);
	});

	// Issue #37: a shared, time-bucketed dedup id let SQS FIFO's 5-minute
	// window discard the second sync of an account, so mail that arrived after
	// a sync stayed invisible until the window elapsed. Back-to-back triggers
	// must each reach the queue.
	it("gives two triggers for one account distinct dedup ids", () => {
		const first = buildSyncMailboxesMessage({ accountId: "account-abc" });
		const second = buildSyncMailboxesMessage({ accountId: "account-abc" });

		assert.notEqual(first.deduplicationId, second.deduplicationId);
	});

	// The worker's fan-out gate reads this off the event: it is what lets a
	// sync asked for by name cover every folder while a side-effect trigger
	// skips the ones that were just enumerated.
	it("marks an explicitly-requested trigger on the event", () => {
		const message = buildSyncMailboxesMessage({
			accountId: "account-abc",
			explicitRequest: true,
		});

		assert.equal(message.body.explicitRequest, true);
	});

	it("leaves a side-effect trigger unmarked", () => {
		const message = buildSyncMailboxesMessage({ accountId: "account-abc" });

		assert.equal(message.body.explicitRequest, undefined);
	});

	it("builds a SYNC_MAILBOXES event body with accountId and eventId", () => {
		const { body } = buildSyncMailboxesMessage({ accountId: "account-abc" });

		assert.equal(body.type, "SYNC_MAILBOXES");
		assert.equal(body.accountId, "account-abc");
		assert.equal(typeof body.eventId, "string");
		assert.equal(typeof body.timestamp, "number");
	});

	it("uses the caller-supplied dedupId instead of the manual default", () => {
		const message = buildSyncMailboxesMessage({
			accountId: "account-abc",
			dedupId: "SYNC_MAILBOXES:scheduled:account-abc:12345",
		});

		assert.equal(
			message.deduplicationId,
			"SYNC_MAILBOXES:scheduled:account-abc:12345",
		);
	});
});

describe("buildScheduledSyncDedupId", () => {
	const FIVE_MINUTES_MS = 5 * 60 * 1000;

	it("is stable within the same time bucket (dedupes a retried tick)", () => {
		const bucketStart = 10 * FIVE_MINUTES_MS;

		const first = buildScheduledSyncDedupId(
			"account-abc",
			bucketStart,
			FIVE_MINUTES_MS,
		);
		const second = buildScheduledSyncDedupId(
			"account-abc",
			bucketStart + 1_000,
			FIVE_MINUTES_MS,
		);

		assert.equal(first, second);
	});

	it("changes across a bucket boundary (never dedupes two ticks apart)", () => {
		const bucketStart = 10 * FIVE_MINUTES_MS;

		const thisTick = buildScheduledSyncDedupId(
			"account-abc",
			bucketStart,
			FIVE_MINUTES_MS,
		);
		const nextTick = buildScheduledSyncDedupId(
			"account-abc",
			bucketStart + FIVE_MINUTES_MS,
			FIVE_MINUTES_MS,
		);

		assert.notEqual(thisTick, nextTick);
	});
});

describe("triggerAccountSync", () => {
	it("sends one SYNC_MAILBOXES message and returns its event id", async () => {
		const queue = recordingQueue();
		const { sent } = queue;

		const result = await triggerAccountSync({
			queue: queue.fifo,
			accountId: "account-xyz",
		});

		assert.equal(sent.length, 1);
		assert.equal(sent[0]?.groupId, "account-xyz");
		assert.equal(sent[0]?.body.type, "SYNC_MAILBOXES");
		assert.equal(result.eventId, sent[0]?.body.eventId);
	});
});
