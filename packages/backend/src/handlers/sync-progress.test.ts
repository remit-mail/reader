/**
 * Unit tests for sync-status aggregation math and phase derivation.
 *
 * Imports the pure helpers from sync-progress.ts directly so the tests pin
 * the shipped implementation (no DynamoDB or AWS infrastructure required).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	computeMessagesSynced,
	deriveMailboxPhase,
	type MailboxSyncFields,
} from "./sync-progress.js";

// ─── deriveMailboxPhase tests ───────────────────────────────────────────────

describe("deriveMailboxPhase", () => {
	it("returns pending when lastMessageSyncAt is 0", () => {
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: 0,
			messageCount: 100,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
		};
		assert.equal(deriveMailboxPhase(mailbox), "pending");
	});

	it("returns pending even when watermarks are set but lastMessageSyncAt is 0", () => {
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: 0,
			messageCount: 50,
			lastSyncUid: 50,
			highWaterMarkUid: 100,
		};
		assert.equal(deriveMailboxPhase(mailbox), "pending");
	});

	it("returns complete when the worker stamped initialSyncCompletedAt after the last batch", () => {
		const now = Date.now();
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: now - 1000,
			initialSyncCompletedAt: now,
			messageCount: 200,
			// Backfill settles at the smallest real UID (sparse UIDs) — the
			// marker, not the watermark, decides completion.
			lastSyncUid: 42,
			highWaterMarkUid: 200,
		};
		assert.equal(deriveMailboxPhase(mailbox), "complete");
	});

	it("returns complete when marker equals lastMessageSyncAt (same-millisecond writes)", () => {
		const now = Date.now();
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: now,
			initialSyncCompletedAt: now,
			messageCount: 10,
			lastSyncUid: 5,
			highWaterMarkUid: 20,
		};
		assert.equal(deriveMailboxPhase(mailbox), "complete");
	});

	it("returns complete for empty mailbox (messageCount 0) without a marker", () => {
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: Date.now(),
			messageCount: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
		};
		assert.equal(deriveMailboxPhase(mailbox), "complete");
	});

	it("returns syncing when a batch was written after the completion marker", () => {
		const now = Date.now();
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: now,
			initialSyncCompletedAt: now - 60_000,
			messageCount: 500,
			lastSyncUid: 150,
			highWaterMarkUid: 500,
		};
		assert.equal(deriveMailboxPhase(mailbox), "syncing");
	});

	it("returns syncing when backfill is in progress and no marker is set", () => {
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: Date.now(),
			messageCount: 500,
			lastSyncUid: 150,
			highWaterMarkUid: 500,
		};
		assert.equal(deriveMailboxPhase(mailbox), "syncing");
	});
});

// ─── computeMessagesSynced tests ───────────────────────────────────────────

describe("computeMessagesSynced", () => {
	it("returns 0 when no sync has started (highWaterMarkUid = 0)", () => {
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: 0,
			messageCount: 100,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
		};
		assert.equal(computeMessagesSynced(mailbox), 0);
	});

	it("computes UID range approximation", () => {
		// highWaterMarkUid - lastSyncUid + 1 = 200 - 150 + 1 = 51
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: Date.now(),
			messageCount: 200,
			lastSyncUid: 150,
			highWaterMarkUid: 200,
		};
		assert.equal(computeMessagesSynced(mailbox), 51);
	});

	it("clamps result to messagesTotal", () => {
		// UID range would be 200 - 1 + 1 = 200; total is 180 (sparse UIDs)
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: Date.now(),
			messageCount: 180,
			lastSyncUid: 1,
			highWaterMarkUid: 200,
		};
		assert.equal(
			computeMessagesSynced(mailbox),
			180,
			"should clamp to messagesTotal",
		);
	});

	it("never returns negative value", () => {
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: Date.now(),
			messageCount: 0,
			lastSyncUid: 100,
			highWaterMarkUid: 50,
		};
		assert.ok(computeMessagesSynced(mailbox) >= 0, "should never be negative");
	});

	it("returns messagesTotal when fully synced (backfill reached the oldest UID)", () => {
		// Fully synced: lastSyncUid settled at the smallest real UID (42).
		// Range 100 - 42 + 1 = 59, clamped to the 50 actual messages.
		const mailbox: MailboxSyncFields = {
			lastMessageSyncAt: Date.now(),
			initialSyncCompletedAt: Date.now(),
			messageCount: 50,
			lastSyncUid: 42,
			highWaterMarkUid: 100,
		};
		assert.equal(computeMessagesSynced(mailbox), 50);
	});
});
