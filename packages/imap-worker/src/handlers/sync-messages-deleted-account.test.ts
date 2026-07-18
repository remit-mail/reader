/**
 * A SYNC_MESSAGES trigger can outlive its account: deletion does not purge the
 * already-queued triggers in lockstep, so a trigger can reference an account
 * whose DDB row is gone. The lookup then raises NotFoundError. That error can
 * never succeed on retry, so it would retry to maxReceiveCount and poison the
 * messages DLQ forever (issue #911).
 *
 * Contract under test:
 *  - missing account (get throws NotFoundError) -> acked + WARN, never thrown
 *  - soft-deleted account (deletedAt set)       -> acked, never thrown
 *  - healthy account                            -> proceeds past the gate (the
 *      handler does real work and fails without a live IMAP server) — proving a
 *      healthy trigger is NOT silently dropped
 *  - transient error (a non-NotFound error)     -> propagates, so SQS retries
 */

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
	_resetForTest,
	_setClientForTest,
	type RemitClient,
} from "@remit/backend/client";
import type { AccountItem } from "@remit/data-ports";
import type { Logger } from "@remit/remit-logger-lambda";
import type { SyncMessagesEvent } from "../events.js";
import { syncMessages } from "./sync-messages.js";

const notFoundError = (message: string): Error => {
	const error = new Error(message);
	error.name = "NotFoundError";
	return error;
};

const setAccountGet = (get: () => Promise<AccountItem>): void => {
	_setClientForTest({ account: { get } } as unknown as RemitClient);
};

interface WarnRecord {
	fields: Record<string, unknown>;
	message: string;
}

const recordingLogger = (warns: WarnRecord[]): Logger => {
	const noop = () => {};
	const log = {
		info: noop,
		warn: (fields: Record<string, unknown>, message: string) => {
			warns.push({ fields, message });
		},
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return log;
};

const healthyAccount = (): AccountItem =>
	({
		accountId: "acct-live",
		accountConfigId: "acfg-live",
		connectionState: "authenticated",
		username: "alice@imap.example.com",
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
	}) as unknown as AccountItem;

const deletedAccount = (): AccountItem =>
	({
		...healthyAccount(),
		accountId: "acct-deleted",
		deletedAt: Date.now(),
	}) as unknown as AccountItem;

const event = (accountId: string): SyncMessagesEvent =>
	({
		type: "SYNC_MESSAGES",
		accountId,
		mailboxId: "mbox-1",
		eventId: "evt-1",
		timestamp: 0,
	}) as SyncMessagesEvent;

afterEach(() => {
	mock.restoreAll();
	_resetForTest();
});

describe("syncMessages deleted/missing account drop (#911)", () => {
	it("acks and warns when the account no longer exists", async () => {
		setAccountGet(async () => {
			throw notFoundError("Account not found: acct-gone");
		});
		const warns: WarnRecord[] = [];

		await assert.doesNotReject(() =>
			syncMessages(event("acct-gone"), recordingLogger(warns)),
		);

		const warn = warns.find((w) =>
			w.message.includes("account no longer exists"),
		);
		assert.ok(warn, "expected a WARN for the missing account");
		assert.equal(warn.fields.accountId, "acct-gone");
		assert.equal(warn.fields.mailboxId, "mbox-1");
		assert.equal(warn.fields.eventId, "evt-1");
	});

	it("acks a soft-deleted account without throwing", async () => {
		setAccountGet(async () => deletedAccount());

		await assert.doesNotReject(() =>
			syncMessages(event("acct-deleted"), recordingLogger([])),
		);
	});

	it("proceeds past the gate for a healthy account (not silently dropped)", async () => {
		setAccountGet(async () => healthyAccount());

		// No live IMAP server, so a healthy account must reach real work and fail
		// there — the not-found gate must not swallow it as a clean ack.
		await assert.rejects(() =>
			syncMessages(event("acct-live"), recordingLogger([])),
		);
	});

	it("propagates a transient error so SQS retries", async () => {
		const transient = new Error("ProvisionedThroughputExceededException");
		setAccountGet(async () => {
			throw transient;
		});

		await assert.rejects(
			() => syncMessages(event("acct-live"), recordingLogger([])),
			transient,
		);
	});
});
