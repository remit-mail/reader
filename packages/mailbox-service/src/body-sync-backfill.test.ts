/**
 * Body-sync's skip guard keys on `bodyStorageKey`, but classification is a
 * separate derived field written by the same pass. A message that got its body
 * before it got a classifier — or whose classifying pass failed after the body
 * landed — is skipped forever and stays `uncategorized` (issue #45).
 *
 * These tests pin the backfill that closes that gap: it reads the stored body
 * rather than IMAP, writes only the classification, and never silently absorbs
 * a storage failure.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	UpdateMessageInput,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import { MessageCategory } from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";

const LINKEDIN_EML = Buffer.from(
	[
		"From: LinkedIn <messages-noreply@linkedin.com>",
		"To: me@example.com",
		"Subject: You have a new invitation",
		"List-Unsubscribe: <https://www.linkedin.com/e/unsub>",
		"Content-Type: text/plain",
		"",
		"invitation",
	].join("\r\n"),
);

interface Harness {
	service: BodySyncService;
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
	threadUpdates: UpdateThreadMessageInput[];
	retrieved: string[];
	connectionAttempts: number;
}

const buildHarness = (
	message: Partial<MessageItem> & Pick<MessageItem, "messageId">,
	retrieve: (key: string) => Promise<Buffer> = async () => LINKEDIN_EML,
): Harness => {
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];
	const threadUpdates: UpdateThreadMessageInput[] = [];
	const retrieved: string[] = [];
	const harness = { connectionAttempts: 0 };

	const messageService = {
		get: async () => ({
			uid: 1,
			category: MessageCategory.uncategorized,
			...message,
		}),
		update: async (messageId: string, input: UpdateMessageInput) => {
			messageUpdates.push({ messageId, input });
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		getByMessageId: async () => ({
			threadMessageId: "tm-1",
			sentDate: 1,
			mailboxId: "mb-1",
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
		}),
		update: async (
			_accountConfigId: string,
			_threadMessageId: string,
			input: UpdateThreadMessageInput,
		) => {
			threadUpdates.push(input);
		},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		retrieve: async (key: string) => {
			retrieved.push(key);
			return retrieve(key);
		},
	} as unknown as StorageService;

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		{} as unknown as IAddressRepository,
		{} as unknown as IEnvelopeRepository,
	);

	return {
		service,
		messageUpdates,
		threadUpdates,
		retrieved,
		get connectionAttempts() {
			return harness.connectionAttempts;
		},
	};
};

const failingConnection = async () => {
	throw new Error("body-sync must not open IMAP to backfill a classification");
};

describe("body-sync classification backfill", () => {
	it("classifies a skipped message whose body is stored but category is uncategorized", async () => {
		const harness = buildHarness({
			messageId: "m-1",
			bodyStorageKey: "s3://bodies/m-1",
			category: MessageCategory.uncategorized,
		});

		const result = await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			failingConnection,
		);

		assert.equal(result.skippedCount, 1);
		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(
			harness.messageUpdates[0].input.category,
			MessageCategory.social,
		);
	});

	it("denormalizes the backfilled category onto the ThreadMessage", async () => {
		const harness = buildHarness({
			messageId: "m-1",
			bodyStorageKey: "s3://bodies/m-1",
			category: MessageCategory.uncategorized,
		});

		await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			failingConnection,
		);

		assert.equal(harness.threadUpdates.length, 1);
		assert.equal(harness.threadUpdates[0].category, MessageCategory.social);
	});

	it("reads the stored body instead of reconnecting to IMAP", async () => {
		const harness = buildHarness({
			messageId: "m-1",
			bodyStorageKey: "s3://bodies/m-1",
			category: MessageCategory.uncategorized,
		});

		await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			failingConnection,
		);

		assert.deepEqual(harness.retrieved, ["s3://bodies/m-1"]);
	});

	it("leaves an already-classified message untouched", async () => {
		const harness = buildHarness({
			messageId: "m-1",
			bodyStorageKey: "s3://bodies/m-1",
			category: MessageCategory.marketing,
		});

		const result = await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			failingConnection,
		);

		assert.equal(result.skippedCount, 1);
		assert.deepEqual(harness.messageUpdates, []);
		assert.deepEqual(harness.retrieved, []);
	});

	it("propagates a storage failure rather than skipping the message", async () => {
		// An unreadable body object is an infra fault. Absorbing it would leave
		// the message permanently unclassified with nothing to show for it.
		const harness = buildHarness(
			{
				messageId: "m-1",
				bodyStorageKey: "s3://bodies/m-1",
				category: MessageCategory.uncategorized,
			},
			async () => {
				throw new Error("AccessDenied");
			},
		);

		await assert.rejects(
			harness.service.syncBodies(
				["m-1"],
				"acc-1",
				"cfg-1",
				"INBOX",
				failingConnection,
			),
			/AccessDenied/,
		);
	});
});
