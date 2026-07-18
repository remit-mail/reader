/**
 * Handler-level guard: an account whose IMAP host is a reserved, never-resolvable
 * placeholder name (RFC 2606 — .invalid/.example) must be skipped cleanly.
 * No connection attempt, no thrown error, so SQS acks the event instead of
 * retrying it into the mailboxes DLQ forever (issue #835).
 *
 * The proof is structural: the only AccountService method the handler may touch
 * is `get`. Any of the post-connect writes (`markAuthenticated`, `update`) firing
 * would mean we passed the skip gate and tried to connect — so those are stubbed
 * to throw, and the test asserts the handler still resolves cleanly.
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
import type { SyncMailboxesEvent, SyncMessagesEvent } from "../events.js";
import { syncMailboxes } from "./sync-mailboxes.js";
import { syncMessages } from "./sync-messages.js";

const silentLogger = (() => {
	const noop = () => {};
	const log = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => log,
	} as unknown as Logger;
	return log;
})();

const reservedAccount = (): AccountItem =>
	({
		accountId: "acct-reserved",
		accountConfigId: "acfg-reserved",
		connectionState: "authenticated",
		username: "alice@imap.invalid",
		imapHost: "imap.invalid",
		imapPort: 993,
		imapTls: true,
	}) as unknown as AccountItem;

const failIfReached = () => {
	throw new Error("post-skip-gate account write must not run");
};

const setClientWithAccountGet = (get: ReturnType<typeof mock.fn>): void => {
	_setClientForTest({
		account: {
			get,
			markAuthenticated: failIfReached,
			update: failIfReached,
		},
	} as unknown as RemitClient);
};

afterEach(() => {
	mock.restoreAll();
	_resetForTest();
});

describe("reserved-host skip gate", () => {
	it("syncMailboxes skips a reserved host cleanly — no connect, no throw", async () => {
		const get = mock.fn(async () => reservedAccount());
		setClientWithAccountGet(get);

		const event = {
			type: "SYNC_MAILBOXES",
			accountId: "acct-reserved",
		} as unknown as SyncMailboxesEvent;

		await assert.doesNotReject(() => syncMailboxes(event, silentLogger));
		assert.equal(get.mock.callCount(), 1);
	});

	it("syncMessages skips a reserved host cleanly — no connect, no throw", async () => {
		const get = mock.fn(async () => reservedAccount());
		setClientWithAccountGet(get);

		const event = {
			type: "SYNC_MESSAGES",
			accountId: "acct-reserved",
			mailboxId: "mbox-1",
		} as unknown as SyncMessagesEvent;

		await assert.doesNotReject(() => syncMessages(event, silentLogger));
		assert.equal(get.mock.callCount(), 1);
	});
});
