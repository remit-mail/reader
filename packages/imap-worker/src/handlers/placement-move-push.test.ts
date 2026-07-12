import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IImapConnection } from "@remit/mailbox-service";
import {
	attemptMove,
	getPlacementMoveMaxAttempts,
	PLACEMENT_MOVE_MAX_ATTEMPTS,
} from "./placement-move-push.js";

const buildConnection = (opts: {
	uidMap?: Map<number, number>;
	moveError?: Error;
	/** Message-ID search hits in the destination mailbox — the verification probe. */
	destinationSearchUids?: number[];
	/** Whether the uid is still found via fetchMessages on the source mailbox. */
	stillAtSource?: boolean;
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
		search: async (_criteria: unknown[]) => opts.destinationSearchUids ?? [],
		fetchMessages: async (uids: number[]) =>
			opts.stillAtSource
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

		it("not-found: confirmed absent from BOTH destination (search miss) AND source (fetch miss)", async () => {
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
