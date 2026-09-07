/**
 * Empty Trash is an EXPUNGE with no undo, so it demands confirmed evidence:
 * what the user appointed, or what the server flagged `\Trash`. The name
 * proposal that serves every other lookup is a guess, and a wrong guess here
 * destroys mail (#837, audit #841). Each way that evidence can be missing
 * refuses under its own reason, so the surface can name the repair (#887).
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
import type { RoleResolution } from "@remit/data-ports/folder-role";
import {
	type MessageMoveConfig,
	MessageMoveService,
	NoTrashMailboxError,
	StaleTrashAppointmentError,
	UnconfirmedTrashMailboxError,
} from "./message-move.js";
import { NO_JUNK_ROLES } from "./test-helpers/folder-roles.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const DELETED_FOLDER = "mbx-deleted";
const REAL_TRASH = "mbx-trash";

type TrashMailbox = { mailboxId: string; fullPath: string };

const appointedTrash: RoleResolution<TrashMailbox> = {
	kind: "appointed",
	mailbox: { mailboxId: REAL_TRASH, fullPath: "[Gmail]/Trash" },
};

// A folder merely named `Deleted` is what the name proposal returns, and the
// confirmed gate is what this path asks for.
const proposedDeletedFolder: RoleResolution<TrashMailbox> = {
	kind: "proposed",
	mailbox: { mailboxId: DELETED_FOLDER, fullPath: "Deleted" },
};

interface TrashMessage {
	messageId: string;
	syncStatus: string;
	status?: string;
	mailboxId?: string;
	uid?: number;
	originalMailboxId?: string;
	originalUid?: number;
}

/**
 * A row mid-move into Trash: the folder is already written, the uid is still
 * the inbox's, and only `status: moving` says so.
 */
const movingIntoTrash = (messageId: string, uid: number): TrashMessage => ({
	messageId,
	syncStatus: "pending",
	status: "moving",
	mailboxId: REAL_TRASH,
	uid,
	originalMailboxId: "mbx-inbox",
	originalUid: uid,
});

interface EnqueuedEvent {
	type: string;
	schemaVersion?: number;
	trashMailboxId?: string;
	trashUidValidity?: number;
}

const buildWorld = (
	trashResolution: RoleResolution<TrashMailbox>,
	trashContents: TrashMessage[] = [
		{ messageId: "junk-1", syncStatus: "synced" },
	],
	/** Message ids whose placement another lane changed after the read. */
	transitionsLost: string[] = [],
) => {
	const emptied: string[] = [];
	const markedDeleting: string[] = [];
	const markPredicates = new Map<string, unknown>();
	const events: EnqueuedEvent[] = [];
	const messagesByMailbox = new Map<string, TrashMessage[]>([
		[DELETED_FOLDER, [{ messageId: "keepsake-1", syncStatus: "synced" }]],
		[REAL_TRASH, trashContents],
	]);

	const messageService = {
		listAllByMailbox: async (mailboxId: string) => {
			emptied.push(mailboxId);
			return messagesByMailbox.get(mailboxId) ?? [];
		},
		update: async (messageId: string) => {
			markedDeleting.push(messageId);
		},
		transitionPlacement: async (messageId: string, expected: unknown) => {
			markPredicates.set(messageId, expected);
			if (transitionsLost.includes(messageId)) return undefined;
			markedDeleting.push(messageId);
			return { messageId };
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		getByMessageId: async () => ({
			accountConfigId: ACCOUNT_CONFIG,
			threadMessageId: "tm-1",
			sentDate: 1_700_000_000_000,
		}),
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const config: MessageMoveConfig = {
		messageService,
		mailboxService: {
			get: async (_accountId: string, mailboxId: string) => ({
				mailboxId,
				uidValidity: 42,
			}),
		} as unknown as IMailboxRepository,
		addressService: {
			reconcileJunkOnlyForMessage: async () => {},
		} as unknown as IAddressRepository,
		mailboxSpecialUseService: {
			resolveTrashRole: async () => trashResolution,
			resolveJunkRolesForConfig: async () => NO_JUNK_ROLES,
		} as unknown as IMailboxSpecialUseRepository,
		threadMessageService,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
	};

	const service = new MessageMoveService(config);
	(
		service as unknown as {
			enqueueEvent: (event: EnqueuedEvent) => Promise<void>;
		}
	).enqueueEvent = async (event) => {
		events.push(event);
	};

	return { service, emptied, markedDeleting, markPredicates, events };
};

describe("MessageMoveService.emptyTrash", () => {
	it("empties the appointed Trash, never the user folder called Deleted", async () => {
		const { service, emptied } = buildWorld(appointedTrash);

		await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.deepEqual(emptied, [REAL_TRASH]);
	});

	it("refuses and names the remedy when no folder is appointed or flagged", async () => {
		const { service, emptied } = buildWorld({ kind: "none" });

		await assert.rejects(
			service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT),
			(error: unknown) =>
				error instanceof NoTrashMailboxError &&
				error.publicApiError?.details?.reason === "none",
		);

		// Nothing was read, so nothing was marked for deletion and no expunge
		// was enqueued: an unresolved Trash stops the operation dead.
		assert.deepEqual(emptied, []);
	});

	it("refuses a Trash that only resolves by name, under its own reason", async () => {
		// D18: a plausible folder nobody confirmed is a third answer, distinct
		// from having none. The refusal is what mints the appointment.
		const { service, emptied, markedDeleting } = buildWorld(
			proposedDeletedFolder,
		);

		await assert.rejects(
			service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT),
			(error: unknown) =>
				error instanceof UnconfirmedTrashMailboxError &&
				error.statusCode === 409 &&
				error.publicApiError?.details?.reason === "unconfirmed" &&
				error.publicApiError?.details?.accountId === ACCOUNT,
		);

		assert.deepEqual(emptied, []);
		assert.deepEqual(markedDeleting, []);
	});

	it("refuses a stale appointment rather than emptying its fallback", async () => {
		const { service, emptied, markedDeleting } = buildWorld({
			kind: "appointment_stale",
			appointedMailboxId: "mbx-appointed-and-gone",
			fallback: { kind: "flagged", mailbox: appointedTrash.mailbox },
		});

		await assert.rejects(
			service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT),
			(error: unknown) =>
				error instanceof StaleTrashAppointmentError &&
				error.publicApiError?.details?.reason === "stale",
		);

		assert.deepEqual(emptied, []);
		assert.deepEqual(markedDeleting, []);
	});

	it("reports what it marked, from the one read that decided it", async () => {
		const { service, markedDeleting } = buildWorld(appointedTrash, [
			{ messageId: "junk-1", syncStatus: "synced" },
			{ messageId: "junk-2", syncStatus: "synced" },
			{ messageId: "junk-3", syncStatus: "synced" },
		]);

		const { deletedCount } = await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.equal(deletedCount, markedDeleting.length);
		assert.equal(deletedCount, 3);
	});

	it("marks and counts a message whose sync is merely pending", async () => {
		// `syncStatus: pending` is where every freshly synced inbound row sits
		// forever; it says nothing about where the message is. The user saw it in
		// Trash and asked for the folder to be emptied, and skipping it would
		// report a number the folder contradicts.
		const { service, markedDeleting } = buildWorld(appointedTrash, [
			{ messageId: "settled-1", syncStatus: "synced" },
			{ messageId: "pending-1", syncStatus: "pending" },
		]);

		const { deletedCount } = await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.deepEqual(markedDeleting, ["settled-1", "pending-1"]);
		assert.equal(deletedCount, 2);
	});

	it("leaves a row whose move into Trash has not settled unmarked and uncounted", async () => {
		// Issue #1217. Marking it `deleting` overwrites the `moving` its own
		// MESSAGE_MOVE reads to decide there is still work to do, so that move
		// returns without touching IMAP and the worker's expunge then binds the
		// inbox's uid against whatever Trash really holds at it.
		const { service, markedDeleting } = buildWorld(appointedTrash, [
			{ messageId: "settled-1", syncStatus: "synced" },
			movingIntoTrash("moving-1", 10),
		]);

		const { deletedCount } = await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.deepEqual(markedDeleting, ["settled-1"]);
		assert.equal(deletedCount, 1);
	});

	it("predicates each mark on the row it just read, and drops the ones it loses", async () => {
		// The rows are held by nothing between the listing and the mark, and
		// PLACEMENT_MOVE_PUSH rides a standard queue this account's FIFO group
		// does not order (imap-mutations R3). A row that moved under the sweep
		// must not be marked `deleting` for an expunge that would bind a uid it
		// no longer has.
		const { service, markedDeleting, markPredicates } = buildWorld(
			appointedTrash,
			[
				{
					messageId: "settled-1",
					syncStatus: "synced",
					status: "active",
					mailboxId: REAL_TRASH,
					uid: 10,
				},
				{
					messageId: "raced-1",
					syncStatus: "synced",
					status: "active",
					mailboxId: REAL_TRASH,
					uid: 11,
				},
			],
			["raced-1"],
		);

		const { deletedCount } = await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.deepEqual(markedDeleting, ["settled-1"]);
		assert.equal(deletedCount, 1, "a row that lost is not counted either");
		assert.deepEqual(markPredicates.get("settled-1"), {
			status: "active",
			mailboxId: REAL_TRASH,
			uid: 10,
		});
	});

	it("reports the same count when pressed twice before the worker runs", async () => {
		// The rows it marked are still in that folder, so N stays true and the
		// re-mark is idempotent. Reporting 0 the second time while still
		// enqueuing an expunge would read as success over an untouched Trash.
		const { service, events } = buildWorld(appointedTrash, [
			{ messageId: "junk-1", syncStatus: "synced" },
			{ messageId: "junk-2", syncStatus: "synced" },
		]);

		const first = await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);
		const second = await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.equal(first.deletedCount, 2);
		assert.equal(second.deletedCount, 2);
		assert.deepEqual(
			events.map((event) => event.type),
			["EMPTY_TRASH", "EMPTY_TRASH"],
		);
	});

	it("carries the folder's identity as it stood at consent time", async () => {
		// The worker compares this against what its own SELECT serves. Without
		// it the expunge would be authorised by a path, and a path is reusable.
		const { service, events } = buildWorld(appointedTrash);

		await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.equal(events[0]?.schemaVersion, 2);
		assert.equal(events[0]?.trashMailboxId, REAL_TRASH);
		assert.equal(events[0]?.trashUidValidity, 42);
	});
});
