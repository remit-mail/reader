/**
 * waitForMailboxSynced — the gate a dependent write (a filter, a move) holds
 * behind while a freshly-created folder is confirmed on the mail server. It
 * resolves only on `synced`, rejects distinctly on `failed` and on timeout, and
 * keeps polling while the row is still `pending` or not yet listed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailboxSyncStatus } from "@remit/domain-enums";
import {
	MAILBOX_SYNC_FAILED_MESSAGE,
	MAILBOX_SYNC_TIMEOUT_MESSAGE,
	type MailboxSyncSignal,
	waitForMailboxSynced,
} from "./mailbox-sync-wait.js";

const row = (
	mailboxId: string,
	syncStatus?: MailboxSyncSignal["syncStatus"],
	extra: Record<string, unknown> = {},
): MailboxSyncSignal & Record<string, unknown> => ({
	mailboxId,
	syncStatus,
	...extra,
});

const noDelay = () => Promise.resolve();

describe("waitForMailboxSynced", () => {
	it("resolves with the confirmed row once it reaches synced", async () => {
		const responses = [
			[row("mbx-1", MailboxSyncStatus.pending)],
			[row("mbx-1", MailboxSyncStatus.pending)],
			[row("mbx-1", MailboxSyncStatus.synced, { fullPath: "Server/Receipts" })],
		];
		let call = 0;
		const result = await waitForMailboxSynced({
			mailboxId: "mbx-1",
			fetchMailboxes: async () => responses[call++],
			delay: noDelay,
		});
		assert.equal(result.syncStatus, MailboxSyncStatus.synced);
		assert.equal(
			(result as Record<string, unknown>).fullPath,
			"Server/Receipts",
		);
		assert.equal(call, 3);
	});

	it("keeps polling while the row is not yet listed", async () => {
		const responses = [
			[] as MailboxSyncSignal[],
			[row("other", MailboxSyncStatus.synced)],
			[row("mbx-1", MailboxSyncStatus.synced)],
		];
		let call = 0;
		const result = await waitForMailboxSynced({
			mailboxId: "mbx-1",
			fetchMailboxes: async () => responses[call++],
			delay: noDelay,
		});
		assert.equal(result.mailboxId, "mbx-1");
		assert.equal(call, 3);
	});

	it("rejects with the failure message when the create is reported failed", async () => {
		await assert.rejects(
			waitForMailboxSynced({
				mailboxId: "mbx-1",
				fetchMailboxes: async () => [row("mbx-1", MailboxSyncStatus.failed)],
				delay: noDelay,
			}),
			(error: unknown) =>
				error instanceof Error && error.message === MAILBOX_SYNC_FAILED_MESSAGE,
		);
	});

	it("rejects with the timeout message when the row never confirms", async () => {
		let clock = 0;
		let fetches = 0;
		await assert.rejects(
			waitForMailboxSynced({
				mailboxId: "mbx-1",
				fetchMailboxes: async () => {
					fetches += 1;
					return [row("mbx-1", MailboxSyncStatus.pending)];
				},
				timeoutMs: 30_000,
				pollIntervalMs: 1_000,
				now: () => clock,
				delay: async (ms) => {
					clock += ms;
				},
			}),
			(error: unknown) =>
				error instanceof Error &&
				error.message === MAILBOX_SYNC_TIMEOUT_MESSAGE,
		);
		assert.ok(fetches > 1, "polls more than once before timing out");
	});

	it("does not treat failed as timeout even past the deadline", async () => {
		let clock = 100_000;
		await assert.rejects(
			waitForMailboxSynced({
				mailboxId: "mbx-1",
				fetchMailboxes: async () => [row("mbx-1", MailboxSyncStatus.failed)],
				timeoutMs: 1,
				now: () => clock++,
				delay: noDelay,
			}),
			(error: unknown) =>
				error instanceof Error && error.message === MAILBOX_SYNC_FAILED_MESSAGE,
		);
	});
});
