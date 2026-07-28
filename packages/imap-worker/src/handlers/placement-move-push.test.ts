import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { getClient, type RemitClient, setClient } from "@remit/backend/client";
import type { Logger } from "@remit/logger-lambda";
import type { IImapConnection } from "@remit/mailbox-service";
import type { PlacementMovePushEvent } from "../events.js";
import {
	attemptMove,
	getPlacementMoveMaxAttempts,
	handlePlacementMovePush,
	PLACEMENT_MOVE_MAX_ATTEMPTS,
} from "./placement-move-push.js";

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

const buildConnection = (opts: {
	uidMap?: Map<number, number>;
	moveError?: Error;
	/** Message-ID search hits in the destination mailbox — the verification probe. */
	destinationSearchUids?: number[];
	/** Whether the message is still in the source mailbox. */
	stillAtSource?: boolean;
	/** The source FETCH drops the row for a message that is still there. */
	sourceFetchDrops?: boolean;
}): IImapConnection =>
	({
		openBox: async () => ({}) as never,
		moveMessages: async (_uids: number[], destination: string) => {
			if (opts.moveError) throw opts.moveError;
			return {
				destination,
				uidValidity: 1,
				uidMap: opts.uidMap ?? new Map(),
			};
		},
		search: async (criteria: unknown[]) => {
			const [first] = criteria;
			if (Array.isArray(first) && first[0] === "UID") {
				return opts.stillAtSource ? [Number(first[1])] : [];
			}
			return opts.destinationSearchUids ?? [];
		},
		fetchMessages: async (uids: number[]) =>
			opts.stillAtSource && !opts.sourceFetchDrops
				? uids.map((uid) => ({ uid }) as unknown as never)
				: [],
	}) as unknown as IImapConnection;

const MESSAGE_ID_HEADER = "<abc@example.com>";

describe("attemptMove — the IMAP push (issue #1271)", () => {
	// Tests use the SAME fake connection for both the source and destination
	// params — attemptMove treats them as independent handles (real cursor
	// guarding per mailbox is #1272's `guardConnectionCursor`, tested in
	// remit-mailbox-service; not re-tested here).
	it("moved: returns the new uid from the COPYUID map", async () => {
		const connection = buildConnection({ uidMap: new Map([[42, 99]]) });

		const outcome = await attemptMove(
			connection,
			connection,
			"Junk",
			"INBOX",
			42,
			MESSAGE_ID_HEADER,
		);

		assert.equal(outcome.kind, "moved");
		assert.equal(outcome.newUid, 99);
	});

	it("trycreate: the destination mailbox does not exist yet", async () => {
		const connection = buildConnection({
			moveError: new Error("Command failed: TRYCREATE"),
		});

		const outcome = await attemptMove(
			connection,
			connection,
			"Junk",
			"NewLabel",
			42,
			MESSAGE_ID_HEADER,
		);

		assert.equal(outcome.kind, "trycreate");
	});

	it("propagates any other error untouched (transient/infra failure, retried by the caller)", async () => {
		const connection = buildConnection({
			moveError: new Error("ECONNRESET"),
		});

		await assert.rejects(
			() =>
				attemptMove(
					connection,
					connection,
					"Junk",
					"INBOX",
					42,
					MESSAGE_ID_HEADER,
				),
			/ECONNRESET/,
		);
	});

	describe("no COPYUID entry / explicit not-found — never trust either without verification (PR #1289 review finding 2)", () => {
		it("moved: no COPYUID entry, but a Message-ID search finds it at the destination (non-UIDPLUS server, genuine success)", async () => {
			const connection = buildConnection({
				uidMap: new Map(),
				destinationSearchUids: [77],
			});

			const outcome = await attemptMove(
				connection,
				connection,
				"Junk",
				"INBOX",
				42,
				MESSAGE_ID_HEADER,
			);

			assert.equal(outcome.kind, "moved");
			assert.equal(outcome.newUid, 77);
		});

		it("moved: explicit NONEXISTENT error, but a Message-ID search finds it at the destination", async () => {
			const connection = buildConnection({
				moveError: new Error("Command failed: NONEXISTENT no such message"),
				destinationSearchUids: [77],
			});

			const outcome = await attemptMove(
				connection,
				connection,
				"Junk",
				"INBOX",
				42,
				MESSAGE_ID_HEADER,
			);

			assert.equal(outcome.kind, "moved");
			assert.equal(outcome.newUid, 77);
		});

		it("throws (never deletes) when unconfirmed at the destination but STILL present at the source", async () => {
			const connection = buildConnection({
				uidMap: new Map(),
				destinationSearchUids: [],
				stillAtSource: true,
			});

			await assert.rejects(
				() =>
					attemptMove(
						connection,
						connection,
						"Junk",
						"INBOX",
						42,
						MESSAGE_ID_HEADER,
					),
				/unresolved/,
			);
		});

		it("throws (never deletes) when the source FETCH drops the row for a message the server still lists", async () => {
			const connection = buildConnection({
				uidMap: new Map(),
				destinationSearchUids: [],
				stillAtSource: true,
				sourceFetchDrops: true,
			});

			await assert.rejects(
				() =>
					attemptMove(
						connection,
						connection,
						"Junk",
						"INBOX",
						42,
						MESSAGE_ID_HEADER,
					),
				/unresolved/,
			);
		});

		it("not-found: confirmed absent from BOTH destination (search miss) AND source (search miss)", async () => {
			const connection = buildConnection({
				uidMap: new Map(),
				destinationSearchUids: [],
				stillAtSource: false,
			});

			const outcome = await attemptMove(
				connection,
				connection,
				"Junk",
				"INBOX",
				42,
				MESSAGE_ID_HEADER,
			);

			assert.equal(outcome.kind, "not-found");
		});

		it("no messageIdHeader to verify with: falls back to the source-presence check alone — still never deletes while present at source", async () => {
			const connection = buildConnection({
				uidMap: new Map(),
				stillAtSource: true,
			});

			await assert.rejects(() =>
				attemptMove(connection, connection, "Junk", "INBOX", 42, undefined),
			);
		});

		it("no messageIdHeader to verify with: resolves not-found once confirmed absent from source", async () => {
			const connection = buildConnection({
				uidMap: new Map(),
				stillAtSource: false,
			});

			const outcome = await attemptMove(
				connection,
				connection,
				"Junk",
				"INBOX",
				42,
				undefined,
			);

			assert.equal(outcome.kind, "not-found");
		});
	});
});

describe("getPlacementMoveMaxAttempts — env-derived threshold (mirrors #1270's getBodySyncMaxAttempts)", () => {
	it("parses the CDK-injected env var", () => {
		assert.equal(
			getPlacementMoveMaxAttempts({ PLACEMENT_MOVE_MAX_ATTEMPTS: "3" }),
			3,
		);
		assert.equal(
			getPlacementMoveMaxAttempts({ PLACEMENT_MOVE_MAX_ATTEMPTS: "5" }),
			5,
		);
	});

	it("defaults to 3 when unset", () => {
		assert.equal(getPlacementMoveMaxAttempts({}), 3);
	});

	it("defaults to 3 on a non-numeric or non-positive value", () => {
		assert.equal(
			getPlacementMoveMaxAttempts({ PLACEMENT_MOVE_MAX_ATTEMPTS: "nope" }),
			3,
		);
		assert.equal(
			getPlacementMoveMaxAttempts({ PLACEMENT_MOVE_MAX_ATTEMPTS: "0" }),
			3,
		);
	});

	it("PLACEMENT_MOVE_MAX_ATTEMPTS is a concrete, positive number at module load", () => {
		assert.ok(PLACEMENT_MOVE_MAX_ATTEMPTS > 0);
	});
});

describe("handlePlacementMovePush — deleted mailbox is terminal (#287/#289)", () => {
	const accountId = "pm-acc-zzz";
	const messageId = "pm-msg-zzz";
	const destinationMailboxId = "pm-dest-zzz";

	const event: PlacementMovePushEvent = {
		type: "PLACEMENT_MOVE_PUSH",
		accountId,
		accountConfigId: "pm-cfg-zzz",
		messageId,
		eventId: "pm-evt-zzz",
		timestamp: 1700000000000,
	};

	// The client is supplied by injection (`setClient`), so these tests register
	// the repositories they then mock rather than reaching a composition.
	before(() => {
		setClient({
			account: { get: async () => undefined },
			message: { get: async () => undefined },
			mailbox: { get: async () => undefined },
			placementMove: {
				find: async () => undefined,
				updateState: async () => undefined,
				delete: async () => undefined,
			},
		} as unknown as RemitClient);
	});

	afterEach(() => mock.restoreAll());

	it("drops the marker and acks without pushing when a mailbox is gone", async () => {
		const client = await getClient();
		mock.method(client.account, "get", async () => ({
			accountId,
			accountConfigId: "pm-cfg-zzz",
		}));
		mock.method(client.message, "get", async () => ({
			messageId,
			mailboxId: destinationMailboxId,
		}));
		mock.method(client.mailbox, "get", async () => {
			throw Object.assign(new Error("Mailbox not found: pm-src-zzz"), {
				name: "NotFoundError",
			});
		});
		mock.method(client.placementMove, "find", async () => ({
			sourceMailboxId: "pm-src-zzz",
			destinationMailboxId,
		}));
		mock.method(client.placementMove, "updateState", async () => {});
		const deleteMarker = mock.method(
			client.placementMove,
			"delete",
			async () => {},
		);

		// Must resolve, not reject — a deleted folder is an expected terminal
		// outcome, not a fault to retry on the account's per-group FIFO.
		await handlePlacementMovePush(event, silentLogger, 1);

		assert.equal(deleteMarker.mock.calls.length, 1, "the marker is dropped");
		assert.deepEqual(deleteMarker.mock.calls[0].arguments, [messageId]);
	});
});
