/**
 * Issue #845 item 3. While a move is in flight the Message row names the
 * destination folder but still carries the SOURCE folder's uid, so a delete
 * that binds the pair as it stands sends the worker to expunge the destination
 * folder's own message at that uid — an unrelated message, destroyed for good.
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
import type { RoleResolution } from "@remit/data-ports/folder-role";
import { MessageMoveService } from "./message-move.js";
import { NO_JUNK_ROLES } from "./test-helpers/folder-roles.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const INBOX = "mbx-inbox";
const ARCHIVE = "mbx-archive";
const TRASH = "mbx-trash";

const MOVING_ID = "msg-moving";
const SETTLED_ID = "msg-settled";
const STRANDED_ID = "msg-stranded";
const COPY_ID = "msg-copy";

const INBOX_UID = 42;
const ARCHIVE_UID = 907;
const SETTLED_UID = 11;

type TrashMailbox = { mailboxId: string; fullPath: string };

const flaggedTrash: RoleResolution<TrashMailbox> = {
	kind: "flagged",
	mailbox: { mailboxId: TRASH, fullPath: "INBOX/Trash" },
};

interface CapturedEvent {
	type: string;
	messageId?: string;
	operation?: string;
	mailboxId?: string;
	mailboxPath?: string;
	uid?: number;
	sourceMailboxPath?: string;
}

const mailboxes = [
	{ mailboxId: INBOX, fullPath: "INBOX", accountId: ACCOUNT },
	{ mailboxId: ARCHIVE, fullPath: "Archive", accountId: ACCOUNT },
	{ mailboxId: TRASH, fullPath: "INBOX/Trash", accountId: ACCOUNT },
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

/** The same row after the trash-move handler gave up without confirming. */
const strandedRow = () => ({
	...movingRow(),
	messageId: STRANDED_ID,
	syncStatus: "failed",
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
		upsert: async (row: Record<string, unknown>) => row,
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [],
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
		create: async () => {},
		update: async () => {},
		delete: async () => {},
	} as unknown as IThreadMessageRepository;

	const mailboxService = {
		get: async (_accountId: string, ids: string | string[]) =>
			Array.isArray(ids)
				? mailboxes.filter((mailbox) => ids.includes(mailbox.mailboxId))
				: mailboxes.find((mailbox) => mailbox.mailboxId === ids),
	} as unknown as IMailboxRepository;

	const mailboxSpecialUseService = {
		resolveTrashRole: async () => flaggedTrash,
		findTrashMailbox: async () => flaggedTrash.mailbox,
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

	const stubs = service as unknown as {
		enqueueEventsBatch: (batch: CapturedEvent[]) => Promise<void>;
		enqueueEvent: (event: CapturedEvent) => Promise<void>;
	};
	stubs.enqueueEventsBatch = async (batch) => {
		events.push(...batch);
	};
	stubs.enqueueEvent = async (event) => {
		events.push(event);
	};

	return { service, patches, events, rows, settle };
};

describe("a delete never binds the folder/uid pair of an in-flight move (#845.3)", () => {
	it("binds the confirmed pair once the move settles", async () => {
		const { service, events, settle } = buildWorld([movingRow()]);

		setTimeout(() => settle(MOVING_ID), 30);
		await service.deleteMessages(ACCOUNT_CONFIG, [MOVING_ID], ACCOUNT);

		assert.equal(events.length, 1);
		assert.equal(events[0].operation, "move_to_trash");
		assert.equal(
			events[0].mailboxPath,
			"Archive",
			"the folder the confirmed move left the message in",
		);
		assert.equal(
			events[0].uid,
			ARCHIVE_UID,
			"and that folder's own uid, never the source folder's",
		);
	});

	it("refuses the delete, and touches nothing, when the move never settles", async () => {
		const { service, patches, events, rows } = buildWorld([movingRow()]);

		await assert.rejects(
			() => service.deleteMessages(ACCOUNT_CONFIG, [MOVING_ID], ACCOUNT),
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
		assert.equal(rows.get(MOVING_ID)?.uid, INBOX_UID);
	});

	it("expunges no part of a mixed batch when one row is in flight", async () => {
		// All-or-nothing: the settled row is deletable on its own, and would be
		// expunged first by a per-row gate. One unverifiable pair refuses the
		// batch it arrived in.
		const { service, patches, events } = buildWorld([
			settledRow(),
			movingRow(),
		]);

		await assert.rejects(
			() =>
				service.deleteMessages(
					ACCOUNT_CONFIG,
					[SETTLED_ID, MOVING_ID],
					ACCOUNT,
					{ permanent: true },
				),
			MessagePlacementUnsettledError,
		);

		assert.deepEqual(
			events,
			[],
			"the settled row was not expunged alongside the refusal",
		);
		assert.deepEqual(patches, []);
	});

	it("deletes the whole batch once the in-flight row settles", async () => {
		const { service, events, settle } = buildWorld([settledRow(), movingRow()]);

		setTimeout(() => settle(MOVING_ID), 30);
		await service.deleteMessages(
			ACCOUNT_CONFIG,
			[SETTLED_ID, MOVING_ID],
			ACCOUNT,
			{ permanent: true },
		);

		assert.deepEqual(
			events.map((event) => [event.messageId, event.uid]).sort(),
			[
				[MOVING_ID, ARCHIVE_UID],
				[SETTLED_ID, SETTLED_UID],
			].sort(),
		);
	});

	it("waits one row's ceiling for a batch, not one per row", async () => {
		// The gate is concurrent. Three in-flight rows that never settle must
		// refuse at roughly one ceiling — a sequential gate would spend three,
		// and at the client's 100-id chunk cap that is a gateway timeout.
		const rows = [movingRow(), movingRow(), movingRow()].map((row, index) => ({
			...row,
			messageId: `${MOVING_ID}-${index}`,
		}));
		const { service } = buildWorld(rows);

		const startedAt = Date.now();
		await assert.rejects(
			() =>
				service.deleteMessages(
					ACCOUNT_CONFIG,
					rows.map((row) => row.messageId),
					ACCOUNT,
					{ permanent: true },
				),
			MessagePlacementUnsettledError,
		);

		assert.ok(
			Date.now() - startedAt < 500,
			"three rows refused within one 200ms ceiling, not three",
		);
	});
});

describe("the gate refuses only a uid that names somebody else (#845.3)", () => {
	it("deletes a freshly copied row rather than waiting on it", async () => {
		// A copy is `moving` with no server-side uid yet. That uid is not ready,
		// which is not the same as naming another folder's message, and the
		// delete of a copy is an ordinary flow that must not stall or refuse.
		const { service, events } = buildWorld([freshCopyRow()]);

		const startedAt = Date.now();
		await service.deleteMessages(ACCOUNT_CONFIG, [COPY_ID], ACCOUNT, {
			permanent: true,
		});

		assert.equal(events.length, 1);
		assert.equal(events[0].operation, "permanent_delete");
		assert.ok(Date.now() - startedAt < 100, "and never entered the wait");
	});

	it("refuses a row stranded by a move that gave up, without spending the ceiling", async () => {
		// `syncStatus: failed` with `status: moving` is the shape every handler's
		// give-up path leaves behind, and only `updateUid` clears it. The pair is
		// still a lie, so the delete is still refused — but under a reason whose
		// remedy is a resync, and without a wait that could never succeed.
		const { service, events } = buildWorld([strandedRow()]);

		const startedAt = Date.now();
		await assert.rejects(
			() => service.deleteMessages(ACCOUNT_CONFIG, [STRANDED_ID], ACCOUNT),
			(error: unknown) =>
				error instanceof MessagePlacementUnsettledError &&
				error.publicApiError?.details?.reason === "unverified",
		);

		assert.deepEqual(events, []);
		assert.ok(Date.now() - startedAt < 100, "refused without waiting");
	});
});

describe("a copy binds the same pair and takes the same gate (#845.3)", () => {
	it("copies from the confirmed pair once the move settles", async () => {
		const { service, events, settle } = buildWorld([movingRow()]);

		setTimeout(() => settle(MOVING_ID), 30);
		await service.copyMessage(ACCOUNT_CONFIG, MOVING_ID, INBOX, ACCOUNT);

		assert.equal(events.length, 1);
		assert.equal(events[0].type, "MESSAGE_COPY");
		assert.equal(events[0].sourceMailboxPath, "Archive");
		assert.equal(events[0].uid, ARCHIVE_UID);
	});

	it("writes no part of a batch copy when one row is in flight", async () => {
		// The gate runs over the whole batch before the first upsert, so a
		// refusal cannot leave copies already committed and enqueued.
		const { service, events } = buildWorld([settledRow(), movingRow()]);

		const startedAt = Date.now();
		await assert.rejects(
			() =>
				service.copyMessages(
					ACCOUNT_CONFIG,
					[SETTLED_ID, MOVING_ID],
					TRASH,
					ACCOUNT,
				),
			MessagePlacementUnsettledError,
		);

		assert.deepEqual(events, [], "no copy was enqueued");
		assert.ok(
			Date.now() - startedAt < 500,
			"and the batch spent one ceiling, not one per row",
		);
	});
});
