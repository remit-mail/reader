import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { getClient, type RemitClient, setClient } from "@remit/backend/client";
import type { Logger } from "@remit/logger-lambda";
import type { FlagPushEvent } from "../events.js";
import {
	FLAG_PUSH_DEFER_MAX_MS,
	FLAG_PUSH_MAX_ATTEMPTS,
	getFlagPushDeferMaxMs,
	getFlagPushMaxAttempts,
	handleFlagPush,
} from "./flag-push.js";

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

describe("getFlagPushMaxAttempts — env-derived threshold (mirrors #1270's getBodySyncMaxAttempts / #1289's getPlacementMoveMaxAttempts)", () => {
	it("parses the CDK-injected env var", () => {
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "3" }), 3);
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "5" }), 5);
	});

	it("defaults to 3 when unset", () => {
		assert.equal(getFlagPushMaxAttempts({}), 3);
	});

	it("defaults to 3 on a non-numeric or non-positive value", () => {
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "nope" }), 3);
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "0" }), 3);
		assert.equal(getFlagPushMaxAttempts({ FLAG_PUSH_MAX_ATTEMPTS: "-1" }), 3);
	});

	it("the module-level constant reflects the actual process env at load time", () => {
		assert.equal(typeof FLAG_PUSH_MAX_ATTEMPTS, "number");
		assert.ok(FLAG_PUSH_MAX_ATTEMPTS > 0);
	});
});

describe("getFlagPushDeferMaxMs", () => {
	it("parses an env override", () => {
		assert.equal(
			getFlagPushDeferMaxMs({ FLAG_PUSH_DEFER_MAX_MS: "1000" }),
			1000,
		);
	});

	it("defaults to 10 minutes when unset or invalid", () => {
		assert.equal(getFlagPushDeferMaxMs({}), 10 * 60 * 1000);
		assert.equal(
			getFlagPushDeferMaxMs({ FLAG_PUSH_DEFER_MAX_MS: "nope" }),
			10 * 60 * 1000,
		);
	});

	it("the module-level constant reflects the actual process env at load time", () => {
		assert.equal(typeof FLAG_PUSH_DEFER_MAX_MS, "number");
		assert.ok(FLAG_PUSH_DEFER_MAX_MS > 0);
	});
});

describe("handleFlagPush — deleted mailbox is terminal (#287/#289)", () => {
	const accountId = "fp-acc-zzz";
	const messageId = "fp-msg-zzz";
	const flagName = "\\Seen";

	const event: FlagPushEvent = {
		type: "FLAG_PUSH",
		accountId,
		accountConfigId: "fp-cfg-zzz",
		messageId,
		flagName,
	} as FlagPushEvent;

	// The client is supplied by injection (`setClient`), so these tests register
	// the repositories they then mock rather than reaching a composition.
	before(() => {
		setClient({
			account: { get: async () => undefined },
			message: { get: async () => undefined },
			mailbox: { get: async () => undefined },
			flagPush: {
				find: async () => undefined,
				updateState: async () => undefined,
				delete: async () => undefined,
			},
		} as unknown as RemitClient);
	});

	afterEach(() => mock.restoreAll());

	it("drops the orphaned marker and acks without pushing when the mailbox is gone", async () => {
		const client = await getClient();
		mock.method(client.account, "get", async () => ({
			accountId,
			accountConfigId: "fp-cfg-zzz",
		}));
		mock.method(client.message, "get", async () => [
			{ messageId, mailboxId: "gone-mbx", uid: 42, status: "active" },
		]);
		mock.method(client.mailbox, "get", async () => {
			throw Object.assign(new Error("Mailbox not found: gone-mbx"), {
				name: "NotFoundError",
			});
		});
		mock.method(client.flagPush, "find", async () => ({
			operation: "add",
			state: "pending",
		}));
		mock.method(client.flagPush, "updateState", async () => {});
		const deleteMarker = mock.method(client.flagPush, "delete", async () => {});

		// Must resolve, not reject — a deleted folder is an expected terminal
		// outcome, not a fault to retry on the account's per-group FIFO.
		await handleFlagPush(event, silentLogger, 1);

		assert.equal(
			deleteMarker.mock.calls.length,
			1,
			"the orphaned marker is dropped",
		);
		assert.deepEqual(deleteMarker.mock.calls[0].arguments, [
			messageId,
			flagName,
		]);
	});
});

describe("handleFlagPush — defers while a move is in flight, never on an ordinary pending sync", () => {
	const accountId = "fp-acc-inflight";
	const messageId = "fp-msg-inflight";
	const flagName = "$Junk";

	const event: FlagPushEvent = {
		type: "FLAG_PUSH",
		accountId,
		accountConfigId: "fp-cfg-inflight",
		messageId,
		flagName,
	} as FlagPushEvent;

	before(() => {
		setClient({
			account: { get: async () => undefined },
			message: { get: async () => undefined },
			mailbox: { get: async () => undefined },
			flagPush: {
				find: async () => undefined,
				updateState: async () => undefined,
				delete: async () => undefined,
			},
		} as unknown as RemitClient);
	});

	afterEach(() => mock.restoreAll());

	it("resets the marker to pending and never opens a connection when the message's move has not settled", async () => {
		const client = await getClient();
		mock.method(client.account, "get", async () => ({
			accountId,
			accountConfigId: "fp-cfg-inflight",
			passwordHash: "not-actually-used-if-guard-works",
		}));
		mock.method(client.message, "get", async () => [
			{
				messageId,
				mailboxId: "mbx-junk",
				uid: 42,
				// Exactly what MessageMoveService.moveMessage's local optimistic
				// write leaves in place while the IMAP MOVE is still in flight.
				status: "moving",
				syncStatus: "pending",
			},
		]);
		const mailboxGet = mock.method(client.mailbox, "get", async () => ({
			mailboxId: "mbx-junk",
			fullPath: "Junk",
		}));
		mock.method(client.flagPush, "find", async () => ({
			operation: "add",
			state: "queued",
			createdAt: Date.now(),
		}));
		const updateState = mock.method(
			client.flagPush,
			"updateState",
			async () => {},
		);
		const deleteMarker = mock.method(client.flagPush, "delete", async () => {});

		await handleFlagPush(event, silentLogger, 1);

		assert.equal(
			mailboxGet.mock.calls.length,
			0,
			"never even resolves the mailbox — returns before touching IMAP",
		);
		assert.equal(
			deleteMarker.mock.calls.length,
			0,
			"the marker is not cleared",
		);
		assert.equal(updateState.mock.calls.length, 1);
		assert.deepEqual(updateState.mock.calls[0].arguments, [
			messageId,
			flagName,
			"pending",
		]);
	});

	it("drops the marker without ever deferring again once a move has been stuck past the defer window", async () => {
		const client = await getClient();
		mock.method(client.account, "get", async () => ({
			accountId,
			accountConfigId: "fp-cfg-inflight",
			passwordHash: "not-actually-used-if-guard-works",
		}));
		mock.method(client.message, "get", async () => [
			{ messageId, mailboxId: "mbx-junk", uid: 42, status: "moving" },
		]);
		const mailboxGet = mock.method(client.mailbox, "get", async () => ({
			mailboxId: "mbx-junk",
			fullPath: "Junk",
		}));
		mock.method(client.flagPush, "find", async () => ({
			operation: "add",
			state: "pending",
			// Long past FLAG_PUSH_DEFER_MAX_MS — the periodic drain has already
			// re-armed and re-deferred this marker many times over.
			createdAt: Date.now() - (FLAG_PUSH_DEFER_MAX_MS + 60_000),
		}));
		const updateState = mock.method(
			client.flagPush,
			"updateState",
			async () => {},
		);
		const deleteMarker = mock.method(client.flagPush, "delete", async () => {});

		await handleFlagPush(event, silentLogger, 1);

		assert.equal(
			mailboxGet.mock.calls.length,
			0,
			"never even resolves the mailbox — returns before touching IMAP",
		);
		assert.equal(
			updateState.mock.calls.length,
			0,
			"never re-armed to pending — this is the terminal outcome, not another defer",
		);
		assert.equal(deleteMarker.mock.calls.length, 1);
		assert.deepEqual(deleteMarker.mock.calls[0].arguments, [
			messageId,
			flagName,
		]);
	});

	it("does NOT defer an ordinary freshly-synced inbound message — syncStatus stays pending forever on the inbound path", async () => {
		// This is the regression the guard must never reintroduce: every
		// message message-sync.ts creates comes out `syncStatus: "pending"`
		// (DrizzleMessageRepository.create's default) and nothing on the
		// inbound path ever promotes it to `synced`. Only `status` names an
		// actual move in flight.
		const client = await getClient();
		mock.method(client.account, "get", async () => ({
			accountId,
			accountConfigId: "fp-cfg-inflight",
			passwordHash: "not-actually-used-if-guard-works",
		}));
		mock.method(client.message, "get", async () => [
			{
				messageId,
				mailboxId: "mbx-junk",
				uid: 42,
				status: "active",
				syncStatus: "pending",
			},
		]);
		// Trips the (unrelated, already-covered) cursor-rebuild early return
		// right after the mailbox lookup — proves the handler reached past the
		// move-in-flight guard without opening a real IMAP connection.
		const mailboxGet = mock.method(client.mailbox, "get", async () => ({
			mailboxId: "mbx-junk",
			fullPath: "Junk",
			cursorState: "cursor_invalid",
		}));
		mock.method(client.flagPush, "find", async () => ({
			operation: "add",
			state: "queued",
			createdAt: Date.now(),
		}));
		const updateState = mock.method(
			client.flagPush,
			"updateState",
			async () => {},
		);
		const deleteMarker = mock.method(client.flagPush, "delete", async () => {});

		await handleFlagPush(event, silentLogger, 1);

		assert.equal(
			mailboxGet.mock.calls.length,
			1,
			"the handler proceeded past the move-in-flight guard",
		);
		assert.equal(deleteMarker.mock.calls.length, 0);
		// "processing" is the advance-to-attempt transition, never "pending" —
		// a re-defer here would be exactly blocker 1 again.
		assert.deepEqual(updateState.mock.calls[0]?.arguments, [
			messageId,
			flagName,
			"processing",
		]);
	});
});
