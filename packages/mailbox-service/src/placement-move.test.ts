import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type {
	MessagePlacementMoveService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import {
	type PlacementMoveConfig,
	PlacementMoveService,
} from "./placement-move.js";

const accountId = "acc-1";
const accountConfigId = "acc-cfg-1";
const messageId = "msg-1";
const sourceMailboxId = "junk-mbx";
const destinationMailboxId = "inbox-mbx";

type MarkerState = "pending" | "queued" | "processing" | "processed";

const createMockSqs = () => {
	const sent: unknown[] = [];
	return {
		send: mock.fn(async (cmd: { input: unknown }) => {
			sent.push(cmd.input);
			return { MessageId: "ok" };
		}),
		_sent: sent,
	};
};

interface Harness {
	service: PlacementMoveService;
	markerPuts: Array<Record<string, unknown>>;
	markerDeletes: string[];
	markerStateUpdates: MarkerState[];
	messageUpdates: Array<Record<string, unknown>>;
	threadMessageUpdates: Array<Record<string, unknown>>;
	mockSqs: ReturnType<typeof createMockSqs>;
	findMarker: () => Promise<Record<string, unknown> | null>;
}

const createHarness = (opts?: {
	markerPutImpl?: () => Promise<unknown>;
	updateForMoveImpl?: () => Promise<unknown>;
	threadUpdateImpl?: () => Promise<unknown>;
	messageMailboxId?: string;
	/**
	 * Simulates a marker that survived from an earlier (partially-failed)
	 * call — e.g. body-sync redelivering after `enqueuePush` threw last time.
	 * `find` returns it until a `put`/`updateState`/`delete` in THIS run
	 * mutates it, mirroring the real stateful marker store closely enough to
	 * exercise the state-engine-driven recovery path.
	 */
	seedMarker?: { destinationMailboxId: string; state: MarkerState } | null;
}): Harness => {
	const markerPuts: Array<Record<string, unknown>> = [];
	const markerDeletes: string[] = [];
	const markerStateUpdates: MarkerState[] = [];
	const messageUpdates: Array<Record<string, unknown>> = [];
	const threadMessageUpdates: Array<Record<string, unknown>> = [];
	let storedMarker: Record<string, unknown> | null = opts?.seedMarker
		? { messageId, ...opts.seedMarker }
		: null;

	const markerService = {
		put: mock.fn(async (input: Record<string, unknown>) => {
			if (opts?.markerPutImpl) await opts.markerPutImpl();
			markerPuts.push(input);
			// A fresh put ALWAYS resets state to "pending" — a new decision
			// starts a new lifecycle, matching the real service's behavior.
			storedMarker = { ...input, state: "pending" };
			return storedMarker;
		}),
		find: mock.fn(async () => storedMarker),
		updateState: mock.fn(async (_id: string, state: MarkerState) => {
			markerStateUpdates.push(state);
			if (!storedMarker) {
				throw new Error(
					"Cannot update state on a MessagePlacementMove that does not exist",
				);
			}
			storedMarker = { ...storedMarker, state };
			return storedMarker;
		}),
		delete: mock.fn(async (id: string) => {
			markerDeletes.push(id);
			storedMarker = null;
		}),
	} as unknown as MessagePlacementMoveService;

	let currentMailboxId = opts?.messageMailboxId ?? sourceMailboxId;

	const messageService = {
		get: mock.fn(async (id: string) => ({
			messageId: id,
			mailboxId: currentMailboxId,
			uid: 42,
		})),
		updateForMove: mock.fn(
			async (id: string, input: Record<string, unknown>) => {
				if (opts?.updateForMoveImpl) await opts.updateForMoveImpl();
				messageUpdates.push({ messageId: id, ...input });
				if (typeof input.mailboxId === "string") {
					currentMailboxId = input.mailboxId;
				}
				return {};
			},
		),
	} as unknown as MessageService;

	const threadMessageService = {
		getByMessageId: mock.fn(async () => ({
			accountConfigId,
			threadMessageId: "tm-1",
			mailboxId: sourceMailboxId,
			sentDate: 1_700_000_000_000,
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		})),
		update: mock.fn(
			async (
				_accountConfigId: string,
				threadMessageId: string,
				input: Record<string, unknown>,
			) => {
				if (opts?.threadUpdateImpl) await opts.threadUpdateImpl();
				threadMessageUpdates.push({ threadMessageId, ...input });
				return {};
			},
		),
	} as unknown as ThreadMessageService;

	const mockSqs = createMockSqs();

	const config: PlacementMoveConfig = {
		messageService,
		threadMessageService,
		markerService,
		sqsQueueUrl: "http://localhost:4566/test-placement-queue",
	};

	const service = new PlacementMoveService(config);
	// @ts-expect-error - replace SQS client with mock
	service.sqs = mockSqs;

	return {
		service,
		markerPuts,
		markerDeletes,
		markerStateUpdates,
		messageUpdates,
		threadMessageUpdates,
		mockSqs,
		findMarker: async () => storedMarker,
	};
};

describe("PlacementMoveService.moveMessage — pending-marker state engine (issue #1271)", () => {
	it("persists the marker (pending), moves the ThreadMessage and Message locally, then enqueues and advances to queued — in that order", async () => {
		const order: string[] = [];
		const h = createHarness({
			markerPutImpl: async () => {
				order.push("marker");
			},
			threadUpdateImpl: async () => {
				order.push("threadMessage");
			},
			updateForMoveImpl: async () => {
				order.push("message");
			},
		});

		await h.service.moveMessage(
			accountConfigId,
			messageId,
			destinationMailboxId,
			accountId,
		);

		assert.equal(h.markerPuts.length, 1);
		assert.deepEqual(h.markerPuts[0], {
			messageId,
			accountId,
			accountConfigId,
			sourceMailboxId,
			destinationMailboxId,
		});
		assert.equal(h.mockSqs._sent.length, 1, "one push event enqueued");
		assert.equal(h.messageUpdates.length, 1);
		assert.equal(h.messageUpdates[0].mailboxId, destinationMailboxId);
		assert.equal(h.messageUpdates[0].status, MessageStatus.moving);
		assert.equal(h.messageUpdates[0].syncStatus, MessageSyncStatus.pending);
		assert.equal(h.messageUpdates[0].originalMailboxId, sourceMailboxId);

		// Strictly sequential: marker (pending) + local move fully commit BEFORE
		// the queue kick runs. The state transition to "queued" happens only
		// AFTER the enqueue succeeds.
		assert.deepEqual(order, ["marker", "threadMessage", "message"]);
		assert.deepEqual(h.markerStateUpdates, ["queued"]);

		const marker = await h.findMarker();
		assert.equal(marker?.state, "queued");
	});

	it("the push event carries only our message id — never a UID (epic #1281 invariant 1)", async () => {
		const h = createHarness();

		await h.service.moveMessage(
			accountConfigId,
			messageId,
			destinationMailboxId,
			accountId,
		);

		const event = h.mockSqs._sent[0] as { MessageBody: string };
		const parsed = JSON.parse(event.MessageBody);
		assert.equal(parsed.type, "PLACEMENT_MOVE_PUSH");
		assert.equal(parsed.messageId, messageId);
		assert.equal(parsed.accountId, accountId);
		assert.equal(parsed.accountConfigId, accountConfigId);
		assert.equal("uid" in parsed, false, "no uid in the pending-move event");
		assert.equal(
			"destinationMailboxId" in parsed,
			false,
			"destination is read from the marker at push time, not carried on the event",
		);
	});

	it("is a true no-op when already at the destination AND no marker survives (steady state, duplicate verdict)", async () => {
		const h = createHarness({
			messageMailboxId: destinationMailboxId,
			seedMarker: null,
		});

		await h.service.moveMessage(
			accountConfigId,
			messageId,
			destinationMailboxId,
			accountId,
		);

		assert.equal(h.markerPuts.length, 0);
		assert.equal(h.messageUpdates.length, 0);
		assert.equal(h.mockSqs._sent.length, 0);
	});

	it("recovery: a `pending` marker survives an earlier enqueue failure — re-enqueues and advances to queued (PR #1289 review finding 1)", async () => {
		// The local move landed on a prior call whose SQS enqueue then threw;
		// body-sync redelivered the whole message, so moveMessage re-runs. State
		// — not a mailboxId comparison — drives the recovery: a `pending` marker
		// always gets driven forward. Without the fix this returns silently —
		// the marker is durable but nothing ever drives it to IMAP again (no
		// retry, no alarm).
		const h = createHarness({
			messageMailboxId: destinationMailboxId,
			seedMarker: { destinationMailboxId, state: "pending" },
		});

		await h.service.moveMessage(
			accountConfigId,
			messageId,
			destinationMailboxId,
			accountId,
		);

		assert.equal(h.markerPuts.length, 0, "does not re-write the marker");
		assert.equal(
			h.messageUpdates.length,
			0,
			"does not re-write the Message row",
		);
		assert.equal(h.mockSqs._sent.length, 1, "re-enqueues the pending push");
		assert.deepEqual(h.markerStateUpdates, ["queued"]);
	});

	for (const state of ["queued", "processing", "processed"] as const) {
		it(`recovery: a marker already in "${state}" has its own driver — no re-enqueue, no state change`, async () => {
			const h = createHarness({
				messageMailboxId: destinationMailboxId,
				seedMarker: { destinationMailboxId, state },
			});

			await h.service.moveMessage(
				accountConfigId,
				messageId,
				destinationMailboxId,
				accountId,
			);

			assert.equal(h.mockSqs._sent.length, 0);
			assert.deepEqual(h.markerStateUpdates, []);
		});
	}

	it("does NOT re-enqueue when a surviving marker's destination disagrees with this call's (defensive — never chase a stale/unrelated marker)", async () => {
		const h = createHarness({
			messageMailboxId: destinationMailboxId,
			seedMarker: {
				destinationMailboxId: "some-other-mailbox",
				state: "pending",
			},
		});

		await h.service.moveMessage(
			accountConfigId,
			messageId,
			destinationMailboxId,
			accountId,
		);

		assert.equal(h.mockSqs._sent.length, 0);
	});

	it("propagates a marker-write failure — never swallowed (the defect this issue fixes)", async () => {
		const h = createHarness({
			markerPutImpl: async () => {
				throw new Error("simulated DynamoDB outage");
			},
		});

		await assert.rejects(
			() =>
				h.service.moveMessage(
					accountConfigId,
					messageId,
					destinationMailboxId,
					accountId,
				),
			/simulated DynamoDB outage/,
		);

		// Nothing after the marker ran — bodyStorageKey (in the caller) is
		// therefore never at risk of going durable without a marker behind it.
		assert.equal(h.messageUpdates.length, 0);
		assert.equal(h.mockSqs._sent.length, 0);
	});

	it("propagates a local-move failure — never swallowed", async () => {
		const h = createHarness({
			updateForMoveImpl: async () => {
				throw new Error("simulated conditional-check failure");
			},
		});

		await assert.rejects(
			() =>
				h.service.moveMessage(
					accountConfigId,
					messageId,
					destinationMailboxId,
					accountId,
				),
			/simulated conditional-check failure/,
		);

		// The marker WAS already durable when this failed — a reconciler could
		// still discover it independently of this specific call's outcome. It is
		// still in `pending`: the enqueue never ran.
		assert.equal(h.markerPuts.length, 1);
		assert.equal(h.mockSqs._sent.length, 0);
		const marker = await h.findMarker();
		assert.equal(marker?.state, "pending");
	});

	it("propagates an SQS enqueue failure — never swallowed. This is a serious operational failure, not a routine blip: the marker stays pending, never silently advances", async () => {
		const h = createHarness();
		h.mockSqs.send = mock.fn(async () => {
			throw new Error("simulated SQS outage");
		});

		await assert.rejects(
			() =>
				h.service.moveMessage(
					accountConfigId,
					messageId,
					destinationMailboxId,
					accountId,
				),
			/simulated SQS outage/,
		);

		// Marker AND local move already landed — only the push notification is
		// missing. The marker remains the durable record of intent, still
		// `pending` (never silently marked `queued` when the enqueue failed).
		assert.equal(h.markerPuts.length, 1);
		assert.equal(h.messageUpdates.length, 1);
		assert.deepEqual(h.markerStateUpdates, []);
		const marker = await h.findMarker();
		assert.equal(marker?.state, "pending");
	});

	it("crash between local-write and enqueue: marker is stuck `pending`; redelivery drives it to `queued`", async () => {
		// End-to-end regression for the orphaned-marker window: before the fix,
		// a retry after this exact failure sequence would hit an early-return
		// and never re-enqueue — durable marker, no driver, move never reaches
		// IMAP, no alarm.
		const h = createHarness();
		let failNextSend = true;
		h.mockSqs.send = mock.fn(async (cmd: { input: unknown }) => {
			if (failNextSend) {
				failNextSend = false;
				throw new Error("simulated SQS outage");
			}
			h.mockSqs._sent.push(cmd.input);
			return { MessageId: "ok" };
		});

		// First attempt (simulates a crash/outage right after the local write):
		// marker (pending) + local move land, enqueue throws — body-sync sees
		// this reject and redelivers the whole message.
		await assert.rejects(() =>
			h.service.moveMessage(
				accountConfigId,
				messageId,
				destinationMailboxId,
				accountId,
			),
		);
		assert.equal(h.markerPuts.length, 1);
		assert.equal(h.messageUpdates.length, 1);
		assert.equal(h.mockSqs._sent.length, 0, "still no push landed");
		let marker = await h.findMarker();
		assert.equal(marker?.state, "pending", "stuck pending after the crash");

		// Retry (redelivery): the recovery branch finds the `pending` marker and
		// drives it forward — re-enqueue, then advance to `queued`.
		await h.service.moveMessage(
			accountConfigId,
			messageId,
			destinationMailboxId,
			accountId,
		);

		assert.equal(h.mockSqs._sent.length, 1, "retry re-enqueued the push");
		assert.equal(
			h.markerPuts.length,
			1,
			"marker was not re-written, only re-driven",
		);
		marker = await h.findMarker();
		assert.equal(marker?.state, "queued");
	});
});
