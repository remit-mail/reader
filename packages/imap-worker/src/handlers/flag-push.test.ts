import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { getClient, type RemitClient, setClient } from "@remit/backend/client";
import type { Logger } from "@remit/logger-lambda";
import type { FlagPushEvent } from "../events.js";
import {
	FLAG_PUSH_MAX_ATTEMPTS,
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
			{ messageId, mailboxId: "gone-mbx", uid: 42 },
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
