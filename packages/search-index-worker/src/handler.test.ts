import assert from "node:assert";
import { describe, test } from "node:test";
import {
	createDeterministicEmbeddingService,
	createMemoryVectorStore,
	createSearchService,
	type SearchService,
} from "@remit/search-service";
import {
	createMockStorageService,
	type StorageService,
} from "@remit/storage-service";
import type { SQSRecord } from "aws-lambda";
import type { IndexEvent } from "./events.js";
import { processBatch } from "./handler.js";
import type { Services } from "./services.js";

const makeRecord = (event: IndexEvent, messageId?: string): SQSRecord =>
	({
		messageId: messageId ?? `sqs-${Math.random().toString(36).slice(2)}`,
		body: JSON.stringify(event),
		receiptHandle: "receipt",
		attributes: {} as SQSRecord["attributes"],
		messageAttributes: {},
		md5OfBody: "",
		eventSource: "aws:sqs",
		eventSourceARN: "arn:aws:sqs:us-east-1:000000000000:test",
		awsRegion: "us-east-1",
	}) as SQSRecord;

const ACCOUNT_ID = "test-account-id";
const ACCOUNT_CONFIG_ID = "test-account-config-id";
const THREAD_ID = "test-thread-id";
const MESSAGE_ID = "test-message-id";
const MAILBOX_IDS = ["inbox-1"];

const makeThreadMessage = (messageId: string) => ({
	threadMessageId: `tm-${messageId}`,
	threadId: THREAD_ID,
	messageId,
	accountConfigId: ACCOUNT_CONFIG_ID,
	mailboxId: MAILBOX_IDS[0],
	uid: 1,
	messageIdHeader: `<${messageId}@test>`,
	inReplyTo: null,
	referenceOrder: 0,
	fromName: "Sender",
	subject: "Test subject",
	internalDate: Date.now(),
	sentDate: Date.now(),
	isRead: false,
	hasAttachment: false,
	star: false,
	hasStars: false,
	isDeleted: false,
	snippet: "Hello world",
	createdAt: Date.now(),
	updatedAt: Date.now(),
});

const threadMessages = new Map<string, ReturnType<typeof makeThreadMessage>>();

const mockThreadMessageService = {
	findByMessageId: async (messageId: string) =>
		threadMessages.get(messageId) ?? null,
} as Services["threadMessageService"];

const createTestServices = (
	storageService: StorageService,
	searchService: SearchService,
): Services => ({
	threadMessageService: mockThreadMessageService,
	storageService,
	searchService,
});

const noopLogger = {
	info: () => {},
	error: () => {},
	warn: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLogger,
	level: "silent",
} as unknown as Parameters<typeof processBatch>[2];

describe("search-index-worker handler", () => {
	test("upsert event indexes message", async () => {
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));
		await storageService.storeParsedBody({
			accountId: ACCOUNT_ID,
			messageId: MESSAGE_ID,
			parsed: {
				text: "Hello world test email content",
				html: null,
				attachments: [],
			},
		});

		const services = createTestServices(storageService, searchService);
		const event: IndexEvent = {
			type: "upsert",
			messageId: MESSAGE_ID,
			accountId: ACCOUNT_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			mailboxIds: MAILBOX_IDS,
		};

		const result = await processBatch(
			[makeRecord(event)],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 0);
		assert.ok(store.size() > 0, "Should have indexed vectors");

		threadMessages.clear();
	});

	test("delete event calls SearchService.delete", async () => {
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		await store.upsert([
			{
				chunkId: `${MESSAGE_ID}::subject`,
				vector: new Array(64).fill(0.1),
				metadata: {
					messageId: MESSAGE_ID,
					threadId: THREAD_ID,
					accountConfigId: ACCOUNT_CONFIG_ID,
					mailboxIds: MAILBOX_IDS,
					chunkType: "subject",
					sentDate: Date.now(),
					isRead: false,
					hasAttachment: false,
					hasStars: false,
				},
			},
		]);
		assert.equal(store.size(), 1);

		const services = createTestServices(storageService, searchService);
		const event: IndexEvent = { type: "delete", messageId: MESSAGE_ID };

		const result = await processBatch(
			[makeRecord(event)],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(store.size(), 0, "Vectors should be deleted");
	});

	test("upsert for deleted message (not in DDB) is silently dropped", async () => {
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.clear();

		const services = createTestServices(storageService, searchService);
		const event: IndexEvent = {
			type: "upsert",
			messageId: "nonexistent-message",
			accountId: ACCOUNT_ID,
			accountConfigId: ACCOUNT_CONFIG_ID,
			mailboxIds: MAILBOX_IDS,
		};

		const result = await processBatch(
			[makeRecord(event)],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(store.size(), 0, "No vectors should be stored");
	});

	test("mixed batch (upsert + delete) processes both correctly", async () => {
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const upsertMsgId = "msg-upsert";
		const deleteMsgId = "msg-delete";

		threadMessages.set(upsertMsgId, makeThreadMessage(upsertMsgId));
		await storageService.storeParsedBody({
			accountId: ACCOUNT_ID,
			messageId: upsertMsgId,
			parsed: {
				text: "Upsert content for search",
				html: null,
				attachments: [],
			},
		});

		await store.upsert([
			{
				chunkId: `${deleteMsgId}::subject`,
				vector: new Array(64).fill(0.1),
				metadata: {
					messageId: deleteMsgId,
					threadId: THREAD_ID,
					accountConfigId: ACCOUNT_CONFIG_ID,
					mailboxIds: MAILBOX_IDS,
					chunkType: "subject",
					sentDate: Date.now(),
					isRead: false,
					hasAttachment: false,
					hasStars: false,
				},
			},
		]);

		const services = createTestServices(storageService, searchService);

		const result = await processBatch(
			[
				makeRecord({
					type: "upsert",
					messageId: upsertMsgId,
					accountId: ACCOUNT_ID,
					accountConfigId: ACCOUNT_CONFIG_ID,
					mailboxIds: MAILBOX_IDS,
				}),
				makeRecord({ type: "delete", messageId: deleteMsgId }),
			],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 0);

		const remainingVectors = await store.query({
			vector: new Array(64).fill(0.1),
			topK: 100,
			filter: { accountConfigId: ACCOUNT_CONFIG_ID },
		});

		const hasUpserted = remainingVectors.some(
			(v) => v.metadata.messageId === upsertMsgId,
		);
		const hasDeleted = remainingVectors.some(
			(v) => v.metadata.messageId === deleteMsgId,
		);

		assert.ok(hasUpserted, "Upserted message should have vectors");
		assert.ok(!hasDeleted, "Deleted message should have no vectors");

		threadMessages.clear();
	});

	test("partial failure returns only failed events in batchItemFailures", async () => {
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const goodMsgId = "msg-good";
		const badMsgId = "msg-bad";

		threadMessages.set(goodMsgId, makeThreadMessage(goodMsgId));
		await storageService.storeParsedBody({
			accountId: ACCOUNT_ID,
			messageId: goodMsgId,
			parsed: {
				text: "Good content",
				html: null,
				attachments: [],
			},
		});

		threadMessages.set(badMsgId, makeThreadMessage(badMsgId));

		const failingSearchService: typeof searchService = {
			...searchService,
			index: async (params) => {
				if (params.metadata.messageId === badMsgId) {
					throw new Error("Simulated indexing failure");
				}
				return searchService.index(params);
			},
			delete: searchService.delete,
			search: searchService.search,
		};

		const failingStorageService: StorageService = {
			...storageService,
			retrieveParsedBody: async (accountId, messageId) => {
				if (messageId === badMsgId) {
					throw new Error("Simulated S3 failure");
				}
				return storageService.retrieveParsedBody(accountId, messageId);
			},
		};

		const services = createTestServices(
			failingStorageService,
			failingSearchService,
		);

		const goodRecord = makeRecord(
			{
				type: "upsert",
				messageId: goodMsgId,
				accountId: ACCOUNT_ID,
				accountConfigId: ACCOUNT_CONFIG_ID,
				mailboxIds: MAILBOX_IDS,
			},
			"sqs-good",
		);

		const badRecord = makeRecord(
			{
				type: "upsert",
				messageId: badMsgId,
				accountId: ACCOUNT_ID,
				accountConfigId: ACCOUNT_CONFIG_ID,
				mailboxIds: MAILBOX_IDS,
			},
			"sqs-bad",
		);

		const result = await processBatch(
			[goodRecord, badRecord],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "sqs-bad");
	});
});
