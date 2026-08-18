/**
 * Empty Trash is an EXPUNGE with no undo, so it resolves its folder through
 * `findConfirmedTrashMailbox` — what the user appointed, or what the server
 * flagged `\Trash`. The name proposal that serves every other lookup is a
 * guess, and a wrong guess here destroys mail (#837, audit #841).
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
import { type MessageMoveConfig, MessageMoveService } from "./message-move.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const DELETED_FOLDER = "mbx-deleted";
const REAL_TRASH = "mbx-trash";

const buildWorld = (
	confirmedTrash: { mailboxId: string; fullPath: string } | null,
) => {
	const emptied: string[] = [];
	const messagesByMailbox = new Map<string, { messageId: string }[]>([
		[DELETED_FOLDER, [{ messageId: "keepsake-1" }]],
		[REAL_TRASH, [{ messageId: "junk-1" }]],
	]);

	const messageService = {
		listAllByMailbox: async (mailboxId: string) => {
			emptied.push(mailboxId);
			return messagesByMailbox.get(mailboxId) ?? [];
		},
		update: async () => {},
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
			// A folder merely named `Deleted` is what the name proposal would
			// return; the confirmed lookup is what this path asks for.
			findTrashMailbox: async () => ({
				mailboxId: DELETED_FOLDER,
				fullPath: "Deleted",
			}),
			findConfirmedTrashMailbox: async () => confirmedTrash,
		} as unknown as IMailboxSpecialUseRepository,
		threadMessageService,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
	};

	const service = new MessageMoveService(config);
	(
		service as unknown as { sqs: { send: (c: unknown) => Promise<unknown> } }
	).sqs = { send: async () => ({}) };

	return { service, emptied };
};

describe("MessageMoveService.emptyTrash", () => {
	it("empties the appointed Trash, never the user folder called Deleted", async () => {
		const { service, emptied } = buildWorld({
			mailboxId: REAL_TRASH,
			fullPath: "[Gmail]/Trash",
		});

		await service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT);

		assert.deepEqual(emptied, [REAL_TRASH]);
	});

	it("refuses and names the remedy when no folder is appointed or flagged", async () => {
		const { service, emptied } = buildWorld(null);

		await assert.rejects(
			service.emptyTrash(ACCOUNT_CONFIG, ACCOUNT),
			/Appoint one under Settings/,
		);

		// Nothing was read, so nothing was marked for deletion and no expunge
		// was enqueued: an unresolved Trash stops the operation dead.
		assert.deepEqual(emptied, []);
	});
});
