import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import {
	type MessageMoveConfig,
	MessageMoveService,
	NoTrashMailboxError,
} from "./message-move.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const INBOX = "mbx-inbox";
const TRASH = "mbx-trash";
const MESSAGE_ID = "msg-1";

interface EnqueuedEvent {
	operation: string;
	destinationMailboxPath?: string;
}

const buildWorld = (
	trash: { mailboxId: string; fullPath: string } | null,
	startingMailboxId = INBOX,
) => {
	const patches: Array<Record<string, unknown>> = [];
	const events: EnqueuedEvent[] = [];
	const threadMessageDeletes: string[] = [];

	const message = {
		messageId: MESSAGE_ID,
		mailboxId: startingMailboxId,
		uid: 337,
		status: "active",
		syncStatus: "synced",
	};

	const messageService = {
		get: async () => [message],
		update: async (_id: string, patch: Record<string, unknown>) => {
			patches.push(patch);
			return Object.assign(message, patch);
		},
		updateForMove: async (_id: string, patch: Record<string, unknown>) => {
			patches.push(patch);
			return Object.assign(message, patch);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [],
		getByMessageId: async () => ({
			accountConfigId: ACCOUNT_CONFIG,
			threadMessageId: "tm-1",
			messageId: MESSAGE_ID,
			mailboxId: startingMailboxId,
		}),
		update: async () => {},
		delete: async (_cfg: string, id: string) => {
			threadMessageDeletes.push(id);
		},
	} as unknown as IThreadMessageRepository;

	const mailboxService = {
		get: async () => [
			{ mailboxId: INBOX, fullPath: "INBOX", accountId: ACCOUNT },
			{ mailboxId: TRASH, fullPath: "INBOX/Trash", accountId: ACCOUNT },
		],
	} as unknown as IMailboxRepository;

	const mailboxSpecialUseService = {
		findTrashMailbox: async () => trash,
	} as unknown as IMailboxSpecialUseRepository;

	const addressService = {
		reconcileJunkOnlyForMessage: async () => {},
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
		service as unknown as {
			enqueueEventsBatch: (batch: EnqueuedEvent[]) => Promise<void>;
		}
	).enqueueEventsBatch = async (batch) => {
		events.push(...batch);
	};

	return { service, patches, events, message };
};

describe("delete only expunges when it was asked to", () => {
	it("moves to a Trash the account resolves under a nested path", async () => {
		const { service, events, message } = buildWorld({
			mailboxId: TRASH,
			fullPath: "INBOX/Trash",
		});

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

		assert.deepEqual(
			events.map((event) => event.operation),
			["move_to_trash"],
		);
		assert.equal(events[0].destinationMailboxPath, "INBOX/Trash");
		assert.equal(message.mailboxId, TRASH);
	});

	it("refuses, and touches nothing, when no Trash resolves", async () => {
		const { service, patches, events, message } = buildWorld(null);

		await assert.rejects(
			() => service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT),
			(error: unknown) =>
				error instanceof NoTrashMailboxError &&
				error.statusCode === 409 &&
				error.message.includes("no Trash folder"),
		);

		assert.deepEqual(events, []);
		assert.deepEqual(patches, []);
		assert.equal(message.mailboxId, INBOX);
		assert.equal(message.status, "active");
	});

	it("expunges only when the caller asked for a permanent delete", async () => {
		const { service, events } = buildWorld({
			mailboxId: TRASH,
			fullPath: "INBOX/Trash",
		});

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT, {
			permanent: true,
		});

		assert.deepEqual(
			events.map((event) => event.operation),
			["permanent_delete"],
		);
	});

	it("expunges a message already in Trash, which the dialog asks as such", async () => {
		const { service, events } = buildWorld(
			{ mailboxId: TRASH, fullPath: "INBOX/Trash" },
			TRASH,
		);

		await service.deleteMessages(ACCOUNT_CONFIG, [MESSAGE_ID], ACCOUNT);

		assert.deepEqual(
			events.map((event) => event.operation),
			["permanent_delete"],
		);
	});
});
