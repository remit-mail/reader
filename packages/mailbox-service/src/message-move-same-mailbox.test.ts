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
import { NO_JUNK_ROLES, trashRole } from "./test-helpers/folder-roles.js";

const stubAddressService = (): IAddressRepository =>
	({
		reconcileJunkOnlyForMessage: async () => {},
	}) as unknown as IAddressRepository;

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const INBOX = "mbx-inbox";
const ARCHIVE = "mbx-archive";
const MESSAGE_ID = "msg-1";

const buildWorld = () => {
	const message = {
		messageId: MESSAGE_ID,
		mailboxId: INBOX,
		uid: 337,
		status: "active",
		syncStatus: "synced",
	};

	const threadRow = {
		accountConfigId: ACCOUNT_CONFIG,
		threadMessageId: "tm-1",
		messageId: MESSAGE_ID,
		mailboxId: INBOX,
		sentDate: 1_700_000_000_000,
		isRead: false,
		isDeleted: false,
		hasStars: false,
		hasAttachment: false,
	};

	const mailboxes = new Map<string, Record<string, unknown>>([
		[INBOX, { mailboxId: INBOX, fullPath: "INBOX", accountId: ACCOUNT }],
		[ARCHIVE, { mailboxId: ARCHIVE, fullPath: "Archive", accountId: ACCOUNT }],
	]);

	const messageService = {
		get: async () => message,
		update: async (_id: string, patch: Record<string, unknown>) =>
			Object.assign(message, patch),
		updateForMove: async (_id: string, patch: Record<string, unknown>) =>
			Object.assign(message, patch),
	} as unknown as IMessageRepository;

	const threadMessageService = {
		getByMessageId: async () => threadRow,
		update: async (_cfg: string, _id: string, patch: Record<string, unknown>) =>
			Object.assign(threadRow, patch),
	} as unknown as IThreadMessageRepository;

	const mailboxService = {
		get: async (_acc: string, id: string) => mailboxes.get(id),
	} as unknown as IMailboxRepository;

	const mailboxSpecialUseService = {
		findTrashMailbox: async () => null,
		resolveTrashRole: async () => trashRole(null),
		resolveJunkRolesForConfig: async () => NO_JUNK_ROLES,
	} as unknown as IMailboxSpecialUseRepository;

	const config: MessageMoveConfig = {
		messageService,
		mailboxService,
		mailboxSpecialUseService,
		threadMessageService,
		addressService: stubAddressService(),
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
	};

	const service = new MessageMoveService(config);
	const sent: unknown[] = [];
	(
		service as unknown as { sqs: { send: (c: unknown) => Promise<unknown> } }
	).sqs = {
		send: async (command: unknown) => {
			sent.push(command);
			return {};
		},
	};

	return { service, message, threadRow, sent };
};

// IMAP has no in-place MOVE: a same-mailbox move expunges the message and
// re-appends it under a new UID, so a request naming the folder the message is
// already in destroys its identity for nothing. It reached the mail server
// because the client can fire the same move twice — the second one after the
// first has already landed.
describe("MessageMoveService.moveMessage — same-mailbox move (#594)", () => {
	it("enqueues nothing when the destination is the mailbox the message is in", async () => {
		const { service, sent } = buildWorld();

		await service.moveMessages(ACCOUNT_CONFIG, [MESSAGE_ID], INBOX, ACCOUNT);

		assert.equal(sent.length, 0, "no IMAP move event was enqueued");
	});

	it("leaves the message row exactly as it was", async () => {
		const { service, message, threadRow } = buildWorld();

		await service.moveMessages(ACCOUNT_CONFIG, [MESSAGE_ID], INBOX, ACCOUNT);

		assert.deepEqual(message, {
			messageId: MESSAGE_ID,
			mailboxId: INBOX,
			uid: 337,
			status: "active",
			syncStatus: "synced",
		});
		assert.equal(threadRow.mailboxId, INBOX);
	});

	it("still moves a message whose destination is a different mailbox", async () => {
		const { service, message, sent } = buildWorld();

		await service.moveMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ARCHIVE, ACCOUNT);

		assert.equal(sent.length, 1, "the real move is enqueued");
		assert.equal(message.mailboxId, ARCHIVE);
		assert.equal(message.syncStatus, "pending");
	});
});
