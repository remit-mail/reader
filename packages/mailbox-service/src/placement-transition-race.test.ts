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

	const world = { row, events, writes } as World;

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
		update: async () => {},
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

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

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

describe("a classification filing writes only against the placement it read (R3)", () => {
	const buildPlacementService = (world: World) => {
		const markers = new Map<string, unknown>();
		const pushed: string[] = [];
		const markerService = {
			find: async () => markers.get(MESSAGE_ID) ?? null,
			put: async (input: Record<string, unknown>) => {
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
		assert.deepEqual(pushed, [MESSAGE_ID]);
		assert.ok(markers.get(MESSAGE_ID));
	});

	it("drops its marker and pushes nothing when the row settles elsewhere", async () => {
		const world = buildWorld();
		const { service, markers, pushed } = buildPlacementService(world);

		// The row settles between this call's read and its write. Nothing in the
		// filing path opens a mailbox, so the settle is staged on the thread-row
		// write that stands between the two.
		world.threadMessageService.update = (async () => {
			world.settleElsewhere();
		}) as unknown as IThreadMessageRepository["update"];

		await service.moveMessage(ACCOUNT_CONFIG, MESSAGE_ID, JUNK, ACCOUNT);

		assert.deepEqual(world.writes, [], "no placement was written");
		assert.deepEqual(pushed, [], "and no push was enqueued");
		assert.equal(
			markers.get(MESSAGE_ID),
			undefined,
			"the marker goes with it: nothing owes IMAP this move",
		);
		assert.equal(world.row.mailboxId, ARCHIVE);
	});
});
