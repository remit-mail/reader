/**
 * RFC 034 Decision 3.1: `Message.category` is written once and never mutated
 * after — RFC 030's message-list GSI sort key depends on it never churning.
 *
 * `applyPostStoreSteps` computes a fresh classification on every pass and
 * folds it into the single Message update, with no check for whether the
 * message already carries a decided category. Two shipped paths re-enter it
 * on an already-classified message — the `NoSuchKey` fallback in
 * `fetchAndGetBody`, and `syncBodies(..., force: true)` — and both must leave
 * `category` untouched. Each test below feeds a re-entrant pass a body that
 * would classify differently from the message's existing category, so a
 * regression that drops the guard shows up even though header classification
 * is otherwise deterministic (issue #355).
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { MessageCategory } from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import type { IImapConnection } from "./types.js";

const LINKEDIN_EML = Buffer.from(
	[
		"From: LinkedIn <messages-noreply@linkedin.com>",
		"To: me@example.com",
		"Subject: You have a new invitation",
		"Content-Type: text/plain",
		"",
		"invitation",
	].join("\r\n"),
);

const PERSONAL_EML = Buffer.from(
	[
		"From: Alex <alex@example.com>",
		"To: me@example.com",
		"Subject: Dinner Friday?",
		"Content-Type: text/plain",
		"",
		"Are you free Friday night?",
	].join("\r\n"),
);

interface Harness {
	service: BodySyncService;
	message: MessageItem;
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
}

const buildHarness = (
	message: Partial<MessageItem> & Pick<MessageItem, "messageId">,
	retrieve: () => Promise<Buffer>,
): Harness => {
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];

	const messageRow = {
		uid: 1,
		mailboxId: "mb-1",
		...message,
	} as unknown as MessageItem;

	const messageService = {
		get: async () => messageRow,
		update: async (messageId: string, input: UpdateMessageInput) => {
			messageUpdates.push({ messageId, input });
			Object.assign(messageRow, input);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [
			{
				threadMessageId: "tm-1",
				messageId: message.messageId,
				mailboxId: "mb-1",
				sentDate: 1,
				isRead: false,
				isDeleted: false,
				hasStars: false,
				hasAttachment: false,
				category: MessageCategory.uncategorized,
			},
		],
		update: async () => {},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		retrieve,
		storeMessageBody: async () => ({ uri: `s3://bodies/${message.messageId}` }),
		storeMessageBodyStream: async () => ({
			uri: `s3://bodies/${message.messageId}`,
		}),
		storeParsedBody: async () => {},
		listBodyParts: async () => [],
	} as unknown as StorageService;

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		{
			getAddress: async () => {
				throw new NotFoundError("Address not found");
			},
			incrementInboundCount: async () => {},
		} as unknown as IAddressRepository,
		{ listBodyParts: async () => [] } as unknown as IEnvelopeRepository,
		{ info: () => {}, error: () => {} },
	);

	return { service, message: messageRow, messageUpdates };
};

const noSuchKeyError = () =>
	Object.assign(new Error("missing"), {
		name: "NoSuchKey",
	});

describe("Message.category survives a re-entrant classification pass", () => {
	it("keeps the existing category through the NoSuchKey IMAP re-fetch", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				bodyStorageKey: "s3://bodies/m-1",
				category: MessageCategory.marketing,
			},
			async () => {
				throw noSuchKeyError();
			},
		);

		const connection = {
			openBox: async () => {},
			fetchMessageBody: async () => LINKEDIN_EML,
		} as unknown as IImapConnection;

		await harness.service.fetchAndGetBody(
			"m-1",
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => connection,
		);

		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(
			harness.messageUpdates[0].input.category,
			MessageCategory.marketing,
		);
		assert.equal(harness.message.category, MessageCategory.marketing);
	});

	it("keeps the existing category when syncBodies re-fetches with force", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				bodyStorageKey: "s3://bodies/m-1",
				category: MessageCategory.marketing,
			},
			async () => {
				throw new Error("force path must not retrieve from storage");
			},
		);

		const connection = {
			openBox: async () => {},
			async *fetchMessageBodies(uids: number[]) {
				for (const uid of uids) {
					yield { uid, source: Readable.from([LINKEDIN_EML]) };
				}
			},
		} as unknown as IImapConnection;

		const result = await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => connection,
			true,
		);

		assert.deepEqual(result.syncedMessageIds, ["m-1"]);
		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(
			harness.messageUpdates[0].input.category,
			MessageCategory.marketing,
		);
		assert.equal(harness.message.category, MessageCategory.marketing);
	});

	it("still writes the category on a first classification", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", category: MessageCategory.uncategorized },
			async () => {
				throw new Error("no body stored yet; must not retrieve");
			},
		);

		const connection = {
			openBox: async () => {},
			fetchMessageBody: async () => PERSONAL_EML,
		} as unknown as IImapConnection;

		await harness.service.fetchAndGetBody(
			"m-1",
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => connection,
		);

		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(
			harness.messageUpdates[0].input.category,
			MessageCategory.personal,
		);
		assert.equal(harness.message.category, MessageCategory.personal);
	});
});
