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
	loggedErrors: Array<Record<string, unknown>>;
}

type MessageFixture = Partial<MessageItem> & Pick<MessageItem, "messageId">;

const buildHarness = (
	messages: MessageFixture[],
	retrieve: (key: string) => Promise<Buffer> = async () => LINKEDIN_EML,
): Harness => {
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];
	const threadUpdates: UpdateThreadMessageInput[] = [];
	const retrieved: string[] = [];
	const loggedErrors: Array<Record<string, unknown>> = [];

	const byId = new Map(messages.map((m) => [m.messageId, m]));

	const messageService = {
		get: async (messageId: string) => {
			const message = byId.get(messageId);
			if (!message) throw new Error(`no fixture for ${messageId}`);
			return { uid: 1, category: MessageCategory.uncategorized, ...message };
		},
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
		{
			info: () => {},
			error: (obj: Record<string, unknown>) => {
				loggedErrors.push(obj);
			},
		},
	);

	return { service, messageUpdates, threadUpdates, retrieved, loggedErrors };
};

const failingConnection = async () => {
	throw new Error("body-sync must not open IMAP to backfill a classification");
};

const stored = (messageId: string) => ({
	messageId,
	bodyStorageKey: `s3://bodies/${messageId}`,
	category: MessageCategory.uncategorized,
});

describe("body-sync classification backfill", () => {
	it("classifies a skipped message whose body is stored but category is uncategorized", async () => {
		const harness = buildHarness([stored("m-1")]);

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
		const harness = buildHarness([stored("m-1")]);

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
		const harness = buildHarness([stored("m-1")]);

		await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			failingConnection,
		);

		assert.deepEqual(harness.retrieved, ["s3://bodies/m-1"]);
	});

	it("classifies a message whose category field is absent entirely", async () => {
		// Rows written before the column existed carry no value at all. Reading
		// that as "already classified" would strand the oldest mail — exactly
		// what this backfill exists to reach.
		const harness = buildHarness([
			{
				messageId: "m-1",
				bodyStorageKey: "s3://bodies/m-1",
				category: undefined,
			},
		]);

		await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			failingConnection,
		);

		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(
			harness.messageUpdates[0].input.category,
			MessageCategory.social,
		);
	});

	it("leaves an already-classified message untouched", async () => {
		const harness = buildHarness([
			{ ...stored("m-1"), category: MessageCategory.marketing },
		]);

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

	it("requeues the message when its stored body cannot be read", async () => {
		// An unreadable body object is an infra fault. Absorbing it would leave
		// the message permanently unclassified with nothing to show for it.
		const harness = buildHarness([stored("m-1")], async () => {
			throw new Error("AccessDenied");
		});

		const result = await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			failingConnection,
		);

		assert.deepEqual(result.failedMessageIds, ["m-1"]);
		assert.equal(result.skippedCount, 0);
	});

	it("logs a backfill failure rather than swallowing it", async () => {
		const harness = buildHarness([stored("m-1")], async () => {
			throw new Error("AccessDenied");
		});

		await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			failingConnection,
		);

		assert.equal(harness.loggedErrors.length, 1);
		assert.equal(harness.loggedErrors[0].messageId, "m-1");
	});

	it("does not abort the batch when one message's backfill fails", async () => {
		// The failure happens in the message-resolution loop, before any body is
		// fetched. Letting it escape would strand every other message in the
		// batch — including ones that need a genuine IMAP fetch — behind one
		// unreadable S3 object.
		const harness = buildHarness(
			[stored("m-bad"), stored("m-good")],
			async (key) => {
				if (key.endsWith("m-bad")) throw new Error("AccessDenied");
				return LINKEDIN_EML;
			},
		);

		const result = await harness.service.syncBodies(
			["m-bad", "m-good"],
			"acc-1",
			"cfg-1",
			"INBOX",
			failingConnection,
		);

		assert.deepEqual(result.failedMessageIds, ["m-bad"]);
		assert.equal(result.skippedCount, 1);
		assert.deepEqual(
			harness.messageUpdates.map((u) => u.messageId),
			["m-good"],
		);
	});
});
