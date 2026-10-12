import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	PlacementPredicate,
} from "@remit/data-ports";
import {
	MessageGoneFromServerError,
	MessagePlacementUnsettledError,
} from "@remit/data-ports/errors";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import type { IImapConnection } from "./types.js";

const MESSAGE_ID = "m-gone";

interface Scenario {
	status: MessageItem["status"];
	rowStillMatches?: boolean;
	serverStillLists?: boolean;
}

const readUnstoredMessage = async ({
	status,
	rowStillMatches = true,
	serverStillLists = false,
}: Scenario) => {
	const predicates: PlacementPredicate[] = [];
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
		deleteIfPlacement: async (
			messageId: string,
			expected: PlacementPredicate,
		) => {
			predicates.push(expected);
			if (!rowStillMatches) return false;
			deletedMessages.push(messageId);
			return true;
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
		fetchMessageBody: async () => null,
		fetchMessages: async () => [],
		search: async () => (serverStillLists ? [42] : []),
	} as unknown as IImapConnection;

	const outcome = await service
		.fetchAndGetBody(
			MESSAGE_ID,
			"acc-1",
			"cfg-1",
			{ fullPath: "INBOX", placement: "inbox" },
			async () => connection,
		)
		.then(
			() => assert.fail("expected the read to be refused"),
			(error: unknown) => error,
		);

	return { outcome, predicates, deletedMessages, deletedThreadMessages };
};

describe("reading a message the mail server no longer holds", () => {
	it("answers 404 and removes the settled row with its thread entries", async () => {
		const { outcome, predicates, deletedMessages, deletedThreadMessages } =
			await readUnstoredMessage({ status: "active" });

		assert.ok(outcome instanceof MessageGoneFromServerError);
		assert.equal(outcome.statusCode, 404);
		assert.deepEqual(predicates, [
			{ status: "active", mailboxId: "mb-inbox", uid: 42 },
		]);
		assert.deepEqual(deletedMessages, [MESSAGE_ID]);
		assert.deepEqual(deletedThreadMessages, ["tm-1"]);
	});

	it("answers 409 and deletes nothing while our own move is in flight", async () => {
		const { outcome, predicates, deletedThreadMessages } =
			await readUnstoredMessage({ status: "moving" });

		assert.ok(outcome instanceof MessagePlacementUnsettledError);
		assert.equal(outcome.statusCode, 409);
		assert.deepEqual(predicates, []);
		assert.deepEqual(deletedThreadMessages, []);
	});

	it("answers 409 and keeps the thread entries when the row changed after it was read", async () => {
		const { outcome, deletedMessages, deletedThreadMessages } =
			await readUnstoredMessage({ status: "active", rowStillMatches: false });

		assert.ok(outcome instanceof MessagePlacementUnsettledError);
		assert.deepEqual(deletedMessages, []);
		assert.deepEqual(deletedThreadMessages, []);
	});

	it("fails loudly and deletes nothing when the server still lists the UID", async () => {
		const { outcome, predicates } = await readUnstoredMessage({
			status: "active",
			serverStillLists: true,
		});

		assert.ok(outcome instanceof Error);
		assert.ok(!(outcome instanceof MessageGoneFromServerError));
		assert.deepEqual(predicates, []);
	});
});
