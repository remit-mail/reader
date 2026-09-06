/**
 * Issue #665. While a placement move is in flight the Message row names the
 * destination folder but still carries the SOURCE folder's uid, so a user move
 * that binds the pair as it stands sends the worker to `openBox(destination)`
 * and `moveMessages([uid])` — the destination folder's own message at that uid,
 * carried off to wherever the user pointed. The reachable press is Undo on the
 * auto-moved badge, inside the seconds before the placement push confirms.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { MessagePlacementUnsettledError } from "@remit/data-ports/errors";
import { MessageMoveService } from "./message-move.js";
import { NO_JUNK_ROLES } from "./test-helpers/folder-roles.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const INBOX = "mbx-inbox";
const ARCHIVE = "mbx-archive";

const MOVING_ID = "msg-moving";
const SETTLED_ID = "msg-settled";
const STRANDED_ID = "msg-stranded";
const COPY_ID = "msg-copy";

const INBOX_UID = 42;
const ARCHIVE_UID = 907;
const SETTLED_UID = 11;

interface CapturedEvent {
	type: string;
	messageId?: string;
	uid?: number;
	sourceMailboxPath?: string;
	destinationMailboxPath?: string;
}

const mailboxes = [
	{ mailboxId: INBOX, fullPath: "INBOX", accountId: ACCOUNT },
	{ mailboxId: ARCHIVE, fullPath: "Archive", accountId: ACCOUNT },
];

/** A row mid-move: Archive is already written, the uid is still INBOX's. */
const movingRow = () => ({
	messageId: MOVING_ID,
	mailboxId: ARCHIVE,
	uid: INBOX_UID,
	status: "moving",
	syncStatus: "pending",
	originalMailboxId: INBOX,
	originalUid: INBOX_UID,
});

/** The same row after the mutation gave up without confirming (R3). */
const strandedRow = () => ({
	...movingRow(),
	messageId: STRANDED_ID,
	syncStatus: "abandoned",
});

/** An ordinary settled row. */
const settledRow = () => ({
	messageId: SETTLED_ID,
	mailboxId: INBOX,
	uid: SETTLED_UID,
	status: "active",
	syncStatus: "synced",
});

/**
 * A freshly copied row: `moving` until COPYUID lands, with no server-side uid
 * at all and no move behind it. Its uid is not ready; it does not name anyone.
 */
const freshCopyRow = () => ({
	messageId: COPY_ID,
	mailboxId: ARCHIVE,
	uid: 0,
	status: "moving",
	syncStatus: "pending",
});

const buildWorld = (seed: Array<Record<string, unknown>>) => {
	const patches: Array<{ messageId: string; patch: Record<string, unknown> }> =
		[];
	const events: CapturedEvent[] = [];
	const rows = new Map<string, Record<string, unknown>>(
		seed.map((row): [string, Record<string, unknown>] => [
			String(row.messageId),
			row,
		]),
	);

	/** What `updateUid` writes when the placement move confirms. */
	const settle = (messageId: string) => {
		Object.assign(rows.get(messageId) ?? {}, {
			uid: ARCHIVE_UID,
			status: "active",
			syncStatus: "synced",
		});
	};

	const messageService = {
		get: async (ids: string | string[]) =>
			Array.isArray(ids)
				? ids.flatMap((id) => {
						const row = rows.get(id);
						return row ? [row] : [];
					})
				: rows.get(ids),
		update: async (id: string, patch: Record<string, unknown>) => {
			patches.push({ messageId: id, patch });
			return Object.assign(rows.get(id) ?? {}, patch);
		},
		updateForMove: async (id: string, patch: Record<string, unknown>) => {
			patches.push({ messageId: id, patch });
			return Object.assign(rows.get(id) ?? {}, patch);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		getByMessageId: async (_cfg: string, messageId: string) => ({
			accountConfigId: ACCOUNT_CONFIG,
			threadMessageId: `tm-${messageId}`,
			messageId,
			threadId: "thr-1",
			mailboxId: rows.get(messageId)?.mailboxId,
			sentDate: 1,
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		}),
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const mailboxService = {
		get: async (_accountId: string, ids: string | string[]) =>
			Array.isArray(ids)
				? mailboxes.filter((mailbox) => ids.includes(mailbox.mailboxId))
				: mailboxes.find((mailbox) => mailbox.mailboxId === ids),
	} as unknown as IMailboxRepository;

	const mailboxSpecialUseService = {
		findTrashMailbox: async () => null,
		resolveJunkRolesForConfig: async () => NO_JUNK_ROLES,
	} as unknown as IMailboxSpecialUseRepository;

	const addressService = {
		reconcileJunkOnlyForMessage: async () => {},
	} as unknown as IAddressRepository;

	const service = new MessageMoveService({
		messageService,
		mailboxService,
		mailboxSpecialUseService,
		threadMessageService,
		addressService,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
		moveSettleTimeoutMs: 200,
		moveSettlePollMs: 10,
	});

	(
		service as unknown as { enqueueEvent: (e: CapturedEvent) => Promise<void> }
	).enqueueEvent = async (event) => {
		events.push(event);
	};

	return { service, patches, events, rows, settle };
};

describe("a move never binds the folder/uid pair of an in-flight move (#665)", () => {
	it("binds the confirmed pair once the placement move settles", async () => {
		const { service, events, settle } = buildWorld([movingRow()]);

		setTimeout(() => settle(MOVING_ID), 30);
		await service.moveMessage(ACCOUNT_CONFIG, MOVING_ID, INBOX, ACCOUNT);

		assert.equal(events.length, 1);
		assert.equal(events[0].type, "MESSAGE_MOVE");
		assert.equal(
			events[0].sourceMailboxPath,
			"Archive",
			"the folder the confirmed move left the message in",
		);
		assert.equal(
			events[0].uid,
			ARCHIVE_UID,
			"and that folder's own uid, never the source folder's",
		);
		assert.equal(events[0].destinationMailboxPath, "INBOX");
	});

	it("refuses the move, and touches nothing, when the placement never settles", async () => {
		const { service, patches, events, rows } = buildWorld([movingRow()]);

		await assert.rejects(
			() => service.moveMessage(ACCOUNT_CONFIG, MOVING_ID, INBOX, ACCOUNT),
			(error: unknown) =>
				error instanceof MessagePlacementUnsettledError &&
				error.statusCode === 409 &&
				error.publicApiError?.code === "message_placement_unsettled" &&
				error.publicApiError?.details?.messageId === MOVING_ID &&
				error.publicApiError?.details?.accountId === ACCOUNT &&
				error.publicApiError?.details?.reason === "in_flight",
		);

		assert.deepEqual(events, [], "nothing was enqueued");
		assert.deepEqual(patches, [], "and no local write was made");
		assert.equal(rows.get(MOVING_ID)?.mailboxId, ARCHIVE);
		assert.equal(rows.get(MOVING_ID)?.uid, INBOX_UID);
	});

	it("never answers the same-mailbox skip from a folder the message has not reached", async () => {
		// The skip compares the row's `mailboxId` against the destination. An
		// in-flight move has already written that folder optimistically, so the
		// comparison would report the message home and return a silent success
		// for a move the server has not made.
		const { service, events } = buildWorld([movingRow()]);

		await assert.rejects(
			() => service.moveMessage(ACCOUNT_CONFIG, MOVING_ID, ARCHIVE, ACCOUNT),
			MessagePlacementUnsettledError,
		);

		assert.deepEqual(events, []);
	});

	it("moves no part of a batch when one row is in flight", async () => {
		// All-or-nothing: the settled row is movable on its own and a per-row
		// gate would have moved it before reaching the refusal.
		const { service, patches, events } = buildWorld([
			settledRow(),
			movingRow(),
		]);

		await assert.rejects(
			() =>
				service.moveMessages(
					ACCOUNT_CONFIG,
					[SETTLED_ID, MOVING_ID],
					ARCHIVE,
					ACCOUNT,
				),
			MessagePlacementUnsettledError,
		);

		assert.deepEqual(
			events,
			[],
			"the settled row was not moved alongside the refusal",
		);
		assert.deepEqual(patches, []);
	});

	it("moves the whole batch once the in-flight row settles", async () => {
		const { service, events, settle } = buildWorld([settledRow(), movingRow()]);

		setTimeout(() => settle(MOVING_ID), 30);
		await service.moveMessages(
			ACCOUNT_CONFIG,
			[SETTLED_ID, MOVING_ID],
			INBOX,
			ACCOUNT,
		);

		assert.deepEqual(
			events.map((event) => [event.messageId, event.uid]),
			[[MOVING_ID, ARCHIVE_UID]],
			"the settled row was already in INBOX and skipped; the moved row went with the confirmed uid",
		);
	});

	it("waits one row's ceiling for a batch, not one per row", async () => {
		const rows = [movingRow(), movingRow(), movingRow()].map((row, index) => ({
			...row,
			messageId: `${MOVING_ID}-${index}`,
		}));
		const { service } = buildWorld(rows);

		const startedAt = Date.now();
		await assert.rejects(
			() =>
				service.moveMessages(
					ACCOUNT_CONFIG,
					rows.map((row) => row.messageId),
					INBOX,
					ACCOUNT,
				),
			MessagePlacementUnsettledError,
		);

		assert.ok(
			Date.now() - startedAt < 500,
			"three rows refused within one 200ms ceiling, not three",
		);
	});
});

describe("the move gate refuses only a uid that names somebody else (#665)", () => {
	it("moves a freshly copied row rather than waiting on it", async () => {
		// A copy is `moving` with no server-side uid yet. That uid is not ready,
		// which is not the same as naming another folder's message.
		const { service, events } = buildWorld([freshCopyRow()]);

		const startedAt = Date.now();
		await service.moveMessage(ACCOUNT_CONFIG, COPY_ID, INBOX, ACCOUNT);

		assert.equal(events.length, 1);
		assert.equal(events[0].type, "MESSAGE_MOVE");
		assert.ok(Date.now() - startedAt < 100, "and never entered the wait");
	});

	it("refuses a row stranded by a move that gave up, without spending the ceiling", async () => {
		// `syncStatus: abandoned` is the give-up value (R3), distinct from the
		// `failed` a transient attempt writes before its redelivery. The pair is
		// still a lie, so the move is still refused — under a reason whose remedy
		// is a resync, and without a wait that could never succeed.
		const { service, events } = buildWorld([strandedRow()]);

		const startedAt = Date.now();
		await assert.rejects(
			() => service.moveMessage(ACCOUNT_CONFIG, STRANDED_ID, INBOX, ACCOUNT),
			(error: unknown) =>
				error instanceof MessagePlacementUnsettledError &&
				error.publicApiError?.details?.reason === "unverified",
		);

		assert.deepEqual(events, []);
		assert.ok(Date.now() - startedAt < 100, "refused without waiting");
	});
});
