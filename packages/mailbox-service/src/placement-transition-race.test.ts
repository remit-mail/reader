/**
 * The three optimistic writers, against a row that moves under them
 * (docs/architecture/imap-mutations.md R3).
 *
 * Each reads a message, does several lookups, then writes where it decided to
 * put it. Between the read and the write, PLACEMENT_MOVE_PUSH can settle the
 * same row: that lane rides a standard queue, which the account's FIFO group
 * does not order against. A blind write then stamps `moving` and the OLD uid
 * over a folder and uid the mail server has just confirmed — a pair
 * `carriesForeignUid` reads as consistent, so nothing downstream catches it —
 * and the event that follows sends the worker after whatever now holds the old
 * number.
 *
 * The repository honours the predicate here the way the real one does, so a
 * losing write returns `undefined` and lands nothing at all.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessagePlacementMoveRepository,
	IMessageRepository,
	IThreadMessageRepository,
	PlacementPredicate,
	PlacementTransitionInput,
} from "@remit/data-ports";
import { MessagePlacementUnsettledError } from "@remit/data-ports/errors";
import { MessageMoveService } from "./message-move.js";
import { PlacementMoveService } from "./placement-move.js";
import { NO_JUNK_ROLES } from "./test-helpers/folder-roles.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const INBOX = "mbx-inbox";
const ARCHIVE = "mbx-archive";
const TRASH = "mbx-trash";
const JUNK = "mbx-junk";
const MESSAGE_ID = "msg-1";

/** What the row is when each writer reads it. */
const READ_UID = 42;

/** What the placement push settles it to while the writer is still deciding. */
const SETTLED_UID = 907;

const mailboxes = [
	{ mailboxId: INBOX, fullPath: "INBOX", accountId: ACCOUNT, uidValidity: 1 },
	{
		mailboxId: ARCHIVE,
		fullPath: "Archive",
		accountId: ACCOUNT,
		uidValidity: 1,
	},
	{ mailboxId: TRASH, fullPath: "Trash", accountId: ACCOUNT, uidValidity: 1 },
	{ mailboxId: JUNK, fullPath: "Junk", accountId: ACCOUNT, uidValidity: 1 },
];

interface CapturedEvent {
	type: string;
	messageId?: string;
	uid?: number;
}

interface Row {
	messageId: string;
	accountConfigId: string;
	mailboxId: string;
	uid: number;
	status: string;
	syncStatus: string;
	abandonedMutation: string;
	originalMailboxId?: string;
	originalUid?: number;
}

const freshRow = (): Row => ({
	messageId: MESSAGE_ID,
	accountConfigId: ACCOUNT_CONFIG,
	mailboxId: INBOX,
	uid: READ_UID,
	status: "active",
	syncStatus: "synced",
	abandonedMutation: "none",
});

interface World {
	row: Row;
	events: CapturedEvent[];
	writes: PlacementTransitionInput[];
	/** Destination folders the listing row was actually moved to. */
	threadMoves: string[];
	/** Stand in for the push settling the row onto Archive with Archive's uid. */
	settleElsewhere: () => void;
	messageService: IMessageRepository;
	threadMessageService: IThreadMessageRepository;
	mailboxService: IMailboxRepository;
	mailboxSpecialUseService: IMailboxSpecialUseRepository;
	addressService: IAddressRepository;
}

const buildWorld = (onLookup?: (world: World) => void): World => {
	const row = freshRow();
	const events: CapturedEvent[] = [];
	const writes: PlacementTransitionInput[] = [];

	const threadMoves: string[] = [];
	const world = { row, events, writes, threadMoves } as World;

	world.settleElsewhere = () => {
		row.mailboxId = ARCHIVE;
		row.uid = SETTLED_UID;
		row.status = "active";
		row.syncStatus = "synced";
		row.originalUid = undefined;
	};

	world.messageService = {
		// A snapshot, the way a repository read is one. Handing back the live
		// object would let the caller's `message` follow the concurrent settle,
		// and the predicate it builds from it would match by accident.
		get: async (ids: string | string[]) =>
			Array.isArray(ids) ? [{ ...row }] : ({ ...row } as unknown),
		update: async () => row,
		transitionPlacement: async (
			_messageId: string,
			expected: PlacementPredicate,
			next: PlacementTransitionInput,
		) => {
			if (expected.status !== undefined && expected.status !== row.status) {
				return undefined;
			}
			if (
				expected.mailboxId !== undefined &&
				expected.mailboxId !== row.mailboxId
			) {
				return undefined;
			}
			if (expected.uid !== undefined && expected.uid !== row.uid) {
				return undefined;
			}
			writes.push(next);
			Object.assign(row, next);
			return row;
		},
	} as unknown as IMessageRepository;

	world.threadMessageService = {
		getByMessageId: async () => ({
			accountConfigId: ACCOUNT_CONFIG,
			threadMessageId: "tm-1",
			messageId: MESSAGE_ID,
			mailboxId: row.mailboxId,
			sentDate: 1,
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		}),
		findAllByMessageId: async () => [],
		update: async (
			_accountConfigId: string,
			_threadMessageId: string,
			patch: { mailboxId?: string },
		) => {
			if (patch.mailboxId) threadMoves.push(patch.mailboxId);
		},
	} as unknown as IThreadMessageRepository;

	// Every writer resolves folders between reading the row and writing it, so
	// this is where the concurrent settle is made to land.
	world.mailboxService = {
		get: async (_accountId: string, ids: string | string[]) => {
			onLookup?.(world);
			return Array.isArray(ids)
				? mailboxes.filter((mailbox) => ids.includes(mailbox.mailboxId))
				: mailboxes.find((mailbox) => mailbox.mailboxId === ids);
		},
	} as unknown as IMailboxRepository;

	world.mailboxSpecialUseService = {
		findTrashMailbox: async () => mailboxes[2],
		resolveTrashRole: async () => ({ kind: "flagged", mailbox: mailboxes[2] }),
		resolveJunkRolesForConfig: async () => NO_JUNK_ROLES,
	} as unknown as IMailboxSpecialUseRepository;

	world.addressService = {
		reconcileJunkOnlyForMessage: async () => {},
	} as unknown as IAddressRepository;

	return world;
};

const buildMoveService = (world: World): MessageMoveService => {
	const service = new MessageMoveService({
		messageService: world.messageService,
		mailboxService: world.mailboxService,
		mailboxSpecialUseService: world.mailboxSpecialUseService,
		threadMessageService: world.threadMessageService,
		addressService: world.addressService,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
		moveSettleTimeoutMs: 100,
		moveSettlePollMs: 10,
	});
	(
		service as unknown as {
			enqueueEvent: (e: CapturedEvent) => Promise<void>;
			enqueueEventsBatch: (e: CapturedEvent[]) => Promise<void>;
		}
	).enqueueEvent = async (event) => {
		world.events.push(event);
	};
	(
		service as unknown as {
			enqueueEventsBatch: (e: CapturedEvent[]) => Promise<void>;
		}
	).enqueueEventsBatch = async (batch) => {
		world.events.push(...batch);
	};
	return service;
};

describe("a user move writes only against the placement it read (R3)", () => {
	it("moves the message when nothing else touched the row", async () => {
		const world = buildWorld();
		const service = buildMoveService(world);

		await service.moveMessage(ACCOUNT_CONFIG, MESSAGE_ID, ARCHIVE, ACCOUNT);

		assert.equal(world.events.length, 1);
		assert.equal(world.row.status, "moving");
		assert.equal(world.row.mailboxId, ARCHIVE);
	});

	it("refuses, and writes nothing, when the row settles elsewhere mid-decision", async () => {
		let settled = false;
		const world = buildWorld((w) => {
			if (settled) return;
			settled = true;
			w.settleElsewhere();
		});
		const service = buildMoveService(world);

		await assert.rejects(
			() => service.moveMessage(ACCOUNT_CONFIG, MESSAGE_ID, JUNK, ACCOUNT),
			(error: unknown) =>
				error instanceof MessagePlacementUnsettledError &&
				error.statusCode === 409,
		);

		assert.deepEqual(world.writes, [], "no placement was written");
		assert.deepEqual(world.events, [], "and nothing was enqueued");
		assert.equal(
			world.row.mailboxId,
			ARCHIVE,
			"the winner's placement stands exactly as it left it",
		);
		assert.equal(world.row.uid, SETTLED_UID);
		assert.equal(world.row.status, "active");
	});
});

describe("a delete writes only against the placement it read (R3)", () => {
	it("marks the message when nothing else touched the row", async () => {
		const world = buildWorld();
		const service = buildMoveService(world);

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

		assert.equal(world.events.length, 1);
		assert.equal(world.row.status, "moving");
		assert.equal(world.row.mailboxId, TRASH);
	});

	it("skips the message, and enqueues nothing for it, when the row settles elsewhere", async () => {
		let settled = false;
		const world = buildWorld((w) => {
			if (settled) return;
			settled = true;
			w.settleElsewhere();
		});
		const service = buildMoveService(world);

		const { refusedMessageIds } = await service.deleteMessages(
			ACCOUNT_CONFIG,
			[MESSAGE_ID],
			ACCOUNT,
		);

		assert.deepEqual(
			refusedMessageIds,
			[MESSAGE_ID],
			"the caller is told which rows this delete never claimed",
		);
		assert.deepEqual(world.writes, [], "no placement was written");
		assert.deepEqual(
			world.events,
			[],
			"and no delete was enqueued against a uid the source no longer holds",
		);
		assert.equal(world.row.mailboxId, ARCHIVE);
		assert.equal(world.row.uid, SETTLED_UID);
	});
});

describe("a permanent delete writes only against the placement it read (R3)", () => {
	// The row is already in Trash, so the batch takes the expunge path rather
	// than the move-to-Trash one — a different writer, and the fourth of the
	// four. Its event names one uid in one folder, so a row that has moved since
	// the read must not be marked for it: a restore out of Trash settling in
	// between was overwritten with `deleting`, and the expunge went after the
	// uid Trash no longer holds.
	const inTrash = (world: World): void => {
		world.row.mailboxId = TRASH;
	};

	it("marks the message when nothing else touched the row", async () => {
		const world = buildWorld();
		inTrash(world);
		const service = buildMoveService(world);

		const { refusedMessageIds } = await service.deleteMessages(
			ACCOUNT_CONFIG,
			[MESSAGE_ID],
			ACCOUNT,
			{ permanent: true },
		);

		assert.deepEqual(refusedMessageIds, []);
		assert.equal(world.row.status, "deleting");
		assert.equal(world.events.length, 1);
	});

	it("reports the message, and enqueues nothing, when the row settles elsewhere", async () => {
		let settled = false;
		const world = buildWorld((w) => {
			if (settled) return;
			settled = true;
			w.settleElsewhere();
		});
		inTrash(world);
		const service = buildMoveService(world);

		const { refusedMessageIds } = await service.deleteMessages(
			ACCOUNT_CONFIG,
			[MESSAGE_ID],
			ACCOUNT,
			{ permanent: true },
		);

		// Reported, never silent: the client removed the row optimistically, and
		// one that reappears with nothing said is a failure the user cannot act
		// on — the same class as a button that does nothing (#1229).
		assert.deepEqual(refusedMessageIds, [MESSAGE_ID]);
		assert.deepEqual(world.writes, [], "no placement was written");
		assert.deepEqual(world.events, [], "and no expunge was enqueued");
		assert.equal(world.row.mailboxId, ARCHIVE);
		assert.equal(world.row.status, "active");
	});
});

describe("a classification filing writes only against the placement it read (R3)", () => {
	const buildPlacementService = (world: World, onPut?: () => void) => {
		const markers = new Map<string, unknown>();
		const pushed: string[] = [];
		const markerService = {
			find: async () => markers.get(MESSAGE_ID) ?? null,
			// The last step between reading the row and writing it, so this is
			// where a concurrent settle is staged.
			put: async (input: Record<string, unknown>) => {
				onPut?.();
				const marker = { ...input, state: "pending", createdAt: Date.now() };
				markers.set(MESSAGE_ID, marker);
				return marker;
			},
			updateState: async () => markers.get(MESSAGE_ID),
			delete: async () => {
				markers.delete(MESSAGE_ID);
			},
		} as unknown as IMessagePlacementMoveRepository;

		const service = new PlacementMoveService({
			messageService: world.messageService,
			threadMessageService: world.threadMessageService,
			markerService,
			addressService: world.addressService,
			mailboxSpecialUseService: world.mailboxSpecialUseService,
			sqsQueueUrl: "http://localhost:9324/000000000000/remit-message-mgmt",
			moveSettleTimeoutMs: 100,
			moveSettlePollMs: 10,
		});
		(service as unknown as { enqueuePush: () => Promise<void> }).enqueuePush =
			async () => {
				pushed.push(MESSAGE_ID);
			};
		return { service, markers, pushed };
	};

	it("files the message when nothing else touched the row", async () => {
		const world = buildWorld();
		const { service, markers, pushed } = buildPlacementService(world);

		await service.moveMessage(ACCOUNT_CONFIG, MESSAGE_ID, JUNK, ACCOUNT);

		assert.equal(world.row.mailboxId, JUNK);
		assert.deepEqual(
			world.threadMoves,
			[JUNK],
			"and the listing row follows the message it describes",
		);
		assert.deepEqual(pushed, [MESSAGE_ID]);
		assert.ok(markers.get(MESSAGE_ID));
	});

	// The Message row is written first, so a loser leaves nothing behind. Moving
	// the listing row ahead of the transition made the loser diverge instead: the
	// listing showed the classification folder while the Message row sat where
	// the winner put it, and nothing routine reconciles that.
	it("leaves the listing row alone too when the row settles elsewhere", async () => {
		const world = buildWorld();
		const { service, markers, pushed } = buildPlacementService(world, () =>
			world.settleElsewhere(),
		);

		await service.moveMessage(ACCOUNT_CONFIG, MESSAGE_ID, JUNK, ACCOUNT);

		assert.deepEqual(world.writes, [], "no placement was written");
		assert.deepEqual(
			world.threadMoves,
			[],
			"and the listing row never claimed a folder the message is not in",
		);
		assert.deepEqual(pushed, [], "and no push was enqueued");
		assert.equal(
			markers.get(MESSAGE_ID),
			undefined,
			"the marker goes with it: nothing owes IMAP this move",
		);
		assert.equal(world.row.mailboxId, ARCHIVE);
	});

	// A permanent delete has already claimed the row. Waiting the ceiling out and
	// then throwing drove an ordinary sequence toward the DLQ; there is nothing
	// left to file, so this skips.
	it("skips a message a delete has claimed, rather than burning the ceiling", async () => {
		const world = buildWorld();
		world.row.status = "deleting";
		const { service, markers, pushed } = buildPlacementService(world);

		const startedAt = Date.now();
		await service.moveMessage(ACCOUNT_CONFIG, MESSAGE_ID, JUNK, ACCOUNT);

		assert.ok(Date.now() - startedAt < 100, "and never entered the wait");
		assert.deepEqual(world.writes, []);
		assert.deepEqual(pushed, []);
		assert.equal(markers.get(MESSAGE_ID), undefined);
	});
});
