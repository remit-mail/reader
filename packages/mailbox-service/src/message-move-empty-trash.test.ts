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
	emptyTrashScope,
	type MessageMoveConfig,
	MessageMoveService,
	NoTrashMailboxError,
	StaleTrashAppointmentError,
	UnconfirmedTrashMailboxError,
} from "./message-move.js";

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

const buildWorld = (
	trashResolution: RoleResolution<TrashMailbox>,
	trashContents: TrashMessage[] = [
		{ messageId: "junk-1", syncStatus: "synced" },
	],
) => {
	const emptied: string[] = [];
	const markedDeleting: string[] = [];
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
		mailboxService: {} as unknown as IMailboxRepository,
		addressService: {
			reconcileJunkOnlyForMessage: async () => {},
		} as unknown as IAddressRepository,
		mailboxSpecialUseService: {
			resolveTrashRole: async () => trashResolution,
		} as unknown as IMailboxSpecialUseRepository,
		threadMessageService,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
	};

	const service = new MessageMoveService(config);
	(
		service as unknown as { sqs: { send: (c: unknown) => Promise<unknown> } }
	).sqs = { send: async () => ({}) };

	return { service, emptied, markedDeleting };
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

	it("leaves a message whose move to Trash has not settled alone", async () => {
		// F7: a `pending` row is a move the server has not confirmed, so it is
		// outside this Empty Trash's scope. Marking it deleting would race the
		// move it is still waiting on; it settles and the next Empty Trash
		// covers it.
		const { service, markedDeleting } = buildWorld(appointedTrash, [
			{ messageId: "settled-1", syncStatus: "synced" },
			{ messageId: "still-moving-1", syncStatus: "pending" },
		]);

		await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.deepEqual(markedDeleting, ["settled-1"]);
	});
});

describe("emptyTrashScope", () => {
	it("is what the handler counts, so the number shown is the number expunged", async () => {
		// The count the API reports and the rows the service marks come from this
		// one filter. Two filters would let the confirmation promise a message
		// the expunge then leaves behind.
		assert.deepEqual(
			emptyTrashScope([
				{ messageId: "settled-1", syncStatus: "synced" },
				{ messageId: "still-moving-1", syncStatus: "pending" },
				{ messageId: "settled-2", syncStatus: "failed" },
			]).map((message) => message.messageId),
			["settled-1", "settled-2"],
		);
	});
});
