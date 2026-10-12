import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
} from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import type { IImapConnection } from "./types.js";

const MESSAGE_ID = "m-gone";

const readGoneMessage = async (status: MessageItem["status"]) => {
	const deletedMessages: string[] = [];
	const deletedThreadMessages: string[] = [];

	const messageService = {
		get: async () =>
			({
				messageId: MESSAGE_ID,
				mailboxId: "mb-inbox",
				uid: 42,
				status,
			}) as unknown as MessageItem,
		delete: async (messageId: string) => {
			deletedMessages.push(messageId);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [
			{ accountConfigId: "cfg-1", threadMessageId: "tm-1" },
		],
		deleteMany: async (keys: { threadMessageId: string }[]) => {
			deletedThreadMessages.push(...keys.map((key) => key.threadMessageId));
		},
	} as unknown as IThreadMessageRepository;

	const service = new BodySyncService(
		messageService,
		{} as unknown as StorageService,
		threadMessageService,
		{} as unknown as IAddressRepository,
		{} as unknown as IEnvelopeRepository,
		{ info: () => {}, error: () => {} },
	);

	const connection = {
		openBox: async () => {},
		fetchMessageBody: async () => ({ outcome: "gone" }),
	} as unknown as IImapConnection;

	const result = await service.fetchAndGetBody(
		MESSAGE_ID,
		"acc-1",
		"cfg-1",
		{ fullPath: "INBOX", placement: "inbox" },
		async () => connection,
	);

	return { result, deletedMessages, deletedThreadMessages };
};

describe("reading a message the mail server no longer holds", () => {
	it("answers gone and removes the settled row with its thread entries", async () => {
		const { result, deletedMessages, deletedThreadMessages } =
			await readGoneMessage("active");

		assert.deepEqual(result, { outcome: "gone" });
		assert.deepEqual(deletedMessages, [MESSAGE_ID]);
		assert.deepEqual(deletedThreadMessages, ["tm-1"]);
	});

	it("leaves a row with a move in flight to that move", async () => {
		const { result, deletedMessages, deletedThreadMessages } =
			await readGoneMessage("moving");

		assert.deepEqual(result, { outcome: "gone" });
		assert.deepEqual(deletedMessages, []);
		assert.deepEqual(deletedThreadMessages, []);
	});
});
