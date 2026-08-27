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
}

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
) => {
	const emptied: string[] = [];
	const markedDeleting: string[] = [];
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

	return { service, emptied, markedDeleting, events };
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

	it("marks and counts a message whose move to Trash has not settled", async () => {
		// The user saw the message in Trash and asked for the folder to be
		// emptied. Skipping it reports a number the folder contradicts, and the
		// queue is per-account FIFO, so the move has landed on the server before
		// the expunge is even delivered.
		const { service, markedDeleting } = buildWorld(appointedTrash, [
			{ messageId: "settled-1", syncStatus: "synced" },
			{ messageId: "still-moving-1", syncStatus: "pending" },
		]);

		const { deletedCount } = await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.deepEqual(markedDeleting, ["settled-1", "still-moving-1"]);
		assert.equal(deletedCount, 2);
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
