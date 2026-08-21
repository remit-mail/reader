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
import { trashRole } from "./test-helpers/folder-roles.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const INBOX = "mbx-inbox";
const TRASH = "mbx-trash";
const MESSAGE_ID = "msg-1";

const buildWorld = (trashExists: boolean) => {
	const reconciled: string[] = [];
	const message = {
		messageId: MESSAGE_ID,
		mailboxId: INBOX,
		uid: 337,
		status: "active",
		syncStatus: "synced",
	};

	const messageService = {
		get: async () => [message],
		update: async (_id: string, patch: Record<string, unknown>) =>
			Object.assign(message, patch),
		updateForMove: async (_id: string, patch: Record<string, unknown>) =>
			Object.assign(message, patch),
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [],
		getByMessageId: async () => ({
			accountConfigId: ACCOUNT_CONFIG,
			threadMessageId: "tm-1",
			messageId: MESSAGE_ID,
			mailboxId: INBOX,
		}),
		update: async () => {},
		delete: async () => {},
	} as unknown as IThreadMessageRepository;

	const mailboxService = {
		get: async () => [
			{ mailboxId: INBOX, fullPath: "INBOX", accountId: ACCOUNT },
		],
	} as unknown as IMailboxRepository;

	const trash = trashExists ? { mailboxId: TRASH, fullPath: "Trash" } : null;

	const mailboxSpecialUseService = {
		findTrashMailbox: async () => trash,
		resolveTrashRole: async () => trashRole(trash),
	} as unknown as IMailboxSpecialUseRepository;

	const addressService = {
		reconcileJunkOnlyForMessage: async (messageId: string) => {
			reconciled.push(`${messageId}@${message.mailboxId}`);
		},
	} as unknown as IAddressRepository;

	const config: MessageMoveConfig = {
		messageService,
		mailboxService,
		mailboxSpecialUseService,
		threadMessageService,
		addressService,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
	};

	const service = new MessageMoveService(config);
	(
		service as unknown as { enqueueEventsBatch: () => Promise<void> }
	).enqueueEventsBatch = async () => {};

	return { service, reconciled };
};

describe("deleting a message re-asks what its senders stand on", () => {
	it("re-asks when the delete moves the message to Trash", async () => {
		const { service, reconciled } = buildWorld(true);

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

		assert.deepEqual(reconciled, [`${MESSAGE_ID}@${TRASH}`]);
	});

	it("asks nothing when the delete is permanent", async () => {
		const { service, reconciled } = buildWorld(true);

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT, {
			permanent: true,
		});

		assert.deepEqual(reconciled, []);
	});

	it("asks nothing when the account has no Trash folder, because the delete is refused", async () => {
		const { service, reconciled } = buildWorld(false);

		await assert.rejects(() =>
			service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT),
		);

		assert.deepEqual(reconciled, []);
	});
});
