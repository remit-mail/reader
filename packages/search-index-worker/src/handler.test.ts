import assert from "node:assert";
import { describe, test } from "node:test";
import { NotFoundError } from "@remit/remit-electrodb-service";
import {
	createDeterministicEmbeddingService,
	createMemoryVectorStore,
	createSearchService,
	type SearchService,
	type VectorRecord,
} from "@remit/search-service";
import {
	createMockStorageService,
	type StorageService,
} from "@remit/storage-service";
import type { SQSRecord } from "aws-lambda";
import { processBatch } from "./handler.js";
import type { SearchIndexMessage } from "./search-index-message.js";
import type { Services } from "./services.js";

const makeRawRecord = (body: string, messageId?: string): SQSRecord =>
	({
		messageId: messageId ?? `sqs-${Math.random().toString(36).slice(2)}`,
		body,
		receiptHandle: "receipt",
		attributes: {} as SQSRecord["attributes"],
		messageAttributes: {},
		md5OfBody: "",
		eventSource: "aws:sqs",
		eventSourceARN: "arn:aws:sqs:us-east-1:000000000000:test",
		awsRegion: "us-east-1",
	}) as SQSRecord;

const makeRecord = (msg: SearchIndexMessage, messageId?: string): SQSRecord =>
	makeRawRecord(JSON.stringify(msg), messageId);

const ACCOUNT_ID = "test-account-id";
const ACCOUNT_CONFIG_ID = "test-account-config-id";
const THREAD_ID = "test-thread-id";
const MESSAGE_ID = "test-message-id";
const MAILBOX_ID = "inbox-1";

const makeSearchIndexMessage = (
	overrides: Partial<SearchIndexMessage> & { messageId: string },
): SearchIndexMessage => ({
	eventName: "INSERT",
	entity: "Message",
	eventID: "evt-1",
	eventTimestamp: Date.now(),
	accountId: ACCOUNT_ID,
	keys: { pk: `msg#${overrides.messageId}`, sk: `msg#${overrides.messageId}` },
	...overrides,
});

const makeThreadMessage = (messageId: string) => ({
	threadMessageId: `tm-${messageId}`,
	threadId: THREAD_ID,
	messageId,
	accountConfigId: ACCOUNT_CONFIG_ID,
	mailboxId: MAILBOX_ID,
	uid: 1,
	messageIdHeader: `<${messageId}@test>`,
	inReplyTo: null,
	referenceOrder: 0,
	fromName: "Sender",
	fromEmail: "sender@test.com",
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
	findByMessageId: async (_accountConfigId: string, messageId: string) =>
		threadMessages.get(messageId) ?? null,
} as Services["threadMessageService"];

const accounts = new Map<string, { accountId: string; deletedAt?: number }>();

const mockAccountService = {
	get: async (accountId: string) => {
		const account = accounts.get(accountId);
		if (!account) throw new NotFoundError(`Account not found: ${accountId}`);
		return { accountConfigId: ACCOUNT_CONFIG_ID, ...account };
	},
} as Services["accountService"];

const createTestServices = (
	storageService: StorageService,
	searchService: SearchService,
	accountService?: Services["accountService"],
): Services => ({
	accountService: accountService ?? mockAccountService,
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
	test("INSERT event indexes message", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: MESSAGE_ID,
			parsed: {
				text: "Hello world test email content",
				html: null,
				attachments: [],
			},
		});

		const services = createTestServices(storageService, searchService);
		const msg = makeSearchIndexMessage({ messageId: MESSAGE_ID });

		const result = await processBatch([makeRecord(msg)], services, noopLogger);

		assert.equal(result.batchItemFailures.length, 0);
		assert.ok(store.size() > 0, "Should have indexed vectors");

		threadMessages.clear();
		accounts.clear();
	});

	test("INSERT stores fromName and subject in vector metadata", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const tm = makeThreadMessage(MESSAGE_ID);
		threadMessages.set(MESSAGE_ID, tm);
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: MESSAGE_ID,
			parsed: {
				text: "Display-field enrichment test content",
				html: null,
				attachments: [],
			},
		});

		const services = createTestServices(storageService, searchService);
		await processBatch(
			[makeRecord(makeSearchIndexMessage({ messageId: MESSAGE_ID }))],
			services,
			noopLogger,
		);

		const vectors = await store.query({
			vector: new Array(64).fill(0.1),
			topK: 100,
			filter: { accountConfigId: ACCOUNT_CONFIG_ID },
		});
		assert.ok(vectors.length > 0, "Should have indexed vectors");
		const forMessage = vectors.filter(
			(v) => v.metadata.messageId === MESSAGE_ID,
		);
		assert.ok(forMessage.length > 0);
		for (const v of forMessage) {
			assert.strictEqual(v.metadata.fromName, tm.fromName ?? null);
			assert.strictEqual(v.metadata.subject, tm.subject ?? "");
		}

		threadMessages.clear();
		accounts.clear();
	});

	test("REMOVE event calls SearchService.delete", async () => {
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
					mailboxIds: [MAILBOX_ID],
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
		const msg = makeSearchIndexMessage({
			messageId: MESSAGE_ID,
			eventName: "REMOVE",
		});

		const result = await processBatch([makeRecord(msg)], services, noopLogger);

		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(store.size(), 0, "Vectors should be deleted");
	});

	test("INSERT for message not in DDB is silently dropped", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.clear();

		const services = createTestServices(storageService, searchService);
		const msg = makeSearchIndexMessage({ messageId: "nonexistent-message" });

		const result = await processBatch([makeRecord(msg)], services, noopLogger);

		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(store.size(), 0, "No vectors should be stored");

		accounts.clear();
	});

	test("INSERT skipped when account not found", async () => {
		accounts.clear();
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));

		const services = createTestServices(storageService, searchService);
		const msg = makeSearchIndexMessage({ messageId: MESSAGE_ID });

		const result = await processBatch([makeRecord(msg)], services, noopLogger);

		assert.equal(
			result.batchItemFailures.length,
			0,
			"should not report failure",
		);
		assert.equal(store.size(), 0, "no vectors should be stored");

		threadMessages.clear();
	});

	test("mixed batch (INSERT + REMOVE) processes both correctly", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const insertMsgId = "msg-insert";
		const removeMsgId = "msg-remove";

		threadMessages.set(insertMsgId, makeThreadMessage(insertMsgId));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: insertMsgId,
			parsed: {
				text: "Upsert content for search",
				html: null,
				attachments: [],
			},
		});

		await store.upsert([
			{
				chunkId: `${removeMsgId}::subject`,
				vector: new Array(64).fill(0.1),
				metadata: {
					messageId: removeMsgId,
					threadId: THREAD_ID,
					accountConfigId: ACCOUNT_CONFIG_ID,
					mailboxIds: [MAILBOX_ID],
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
				makeRecord(makeSearchIndexMessage({ messageId: insertMsgId })),
				makeRecord(
					makeSearchIndexMessage({
						messageId: removeMsgId,
						eventName: "REMOVE",
					}),
				),
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

		const hasInserted = remainingVectors.some(
			(v) => v.metadata.messageId === insertMsgId,
		);
		const hasRemoved = remainingVectors.some(
			(v) => v.metadata.messageId === removeMsgId,
		);

		assert.ok(hasInserted, "Inserted message should have vectors");
		assert.ok(!hasRemoved, "Removed message should have no vectors");

		threadMessages.clear();
		accounts.clear();
	});

	test("two INSERT messages for same account upsert per message (isolated)", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const baseSearchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const msgId1 = "msg-batch-1";
		const msgId2 = "msg-batch-2";

		threadMessages.set(msgId1, makeThreadMessage(msgId1));
		threadMessages.set(msgId2, makeThreadMessage(msgId2));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: msgId1,
			parsed: { text: "Content one", html: null, attachments: [] },
		});
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: msgId2,
			parsed: { text: "Content two", html: null, attachments: [] },
		});

		const upsertCallArgs: VectorRecord[][] = [];
		const trackingSearchService: SearchService = {
			...baseSearchService,
			upsertVectors: async (records: VectorRecord[]) => {
				upsertCallArgs.push(records);
				return baseSearchService.upsertVectors(records);
			},
		};

		const services = createTestServices(storageService, trackingSearchService);

		const result = await processBatch(
			[
				makeRecord(makeSearchIndexMessage({ messageId: msgId1 })),
				makeRecord(makeSearchIndexMessage({ messageId: msgId2 })),
			],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(
			upsertCallArgs.length,
			2,
			"Should upsert once per SQS message",
		);
		for (const call of upsertCallArgs) {
			const messageIds = new Set(call.map((v) => v.metadata.messageId));
			assert.equal(
				messageIds.size,
				1,
				"Each upsert call should hold a single message's vectors",
			);
		}
		assert.ok(store.size() > 0, "Vectors should be stored");

		threadMessages.clear();
		accounts.clear();
	});

	test("duplicate chunkIds within one message are deduped (last write wins)", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const baseSearchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: MESSAGE_ID,
			parsed: { text: "Dedup content", html: null, attachments: [] },
		});

		let dupedChunkId = "";
		let upsertCallArgs: VectorRecord[] = [];
		let upsertVectorsCalls = 0;
		// prepareVectors normally emits unique chunkIds; wrap it to inject a
		// duplicate so we prove the handler collapses duplicate keys before the
		// single PutVectors call (S3 Vectors rejects duplicate keys).
		const trackingSearchService: SearchService = {
			...baseSearchService,
			prepareVectors: async (params) => {
				const records = await baseSearchService.prepareVectors(params);
				const first = records[0];
				assert.ok(first, "expected at least one prepared vector");
				dupedChunkId = first.chunkId;
				return [
					{ ...first, metadata: { ...first.metadata, subject: "Old" } },
					...records,
					{ ...first, metadata: { ...first.metadata, subject: "New" } },
				];
			},
			upsertVectors: async (records: VectorRecord[]) => {
				upsertVectorsCalls++;
				upsertCallArgs = records;
				return baseSearchService.upsertVectors(records);
			},
		};

		const services = createTestServices(storageService, trackingSearchService);

		const result = await processBatch(
			[
				makeRecord(
					makeSearchIndexMessage({
						messageId: MESSAGE_ID,
						eventName: "INSERT",
					}),
					"sqs-insert",
				),
			],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(upsertVectorsCalls, 1, "one upsert call for the message");

		const chunkIds = upsertCallArgs.map((r) => r.chunkId);
		assert.equal(
			chunkIds.length,
			new Set(chunkIds).size,
			"no duplicate chunkIds in the upsert batch",
		);

		const collapsed = upsertCallArgs.find((r) => r.chunkId === dupedChunkId);
		assert.ok(collapsed, "the duplicated chunk should be present once");
		assert.equal(
			collapsed.metadata.subject,
			"New",
			"the later duplicate should supersede the earlier one",
		);

		threadMessages.clear();
		accounts.clear();
	});

	test("one rejected message fails alone; its siblings still index (#904)", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const baseSearchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const goodMsgId = "msg-ok";
		const badMsgId = "msg-poison";

		threadMessages.set(goodMsgId, makeThreadMessage(goodMsgId));
		threadMessages.set(badMsgId, makeThreadMessage(badMsgId));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: goodMsgId,
			parsed: { text: "Good content", html: null, attachments: [] },
		});
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: badMsgId,
			parsed: { text: "Poison content", html: null, attachments: [] },
		});

		// S3 Vectors rejects only the poison message's records (a deterministic
		// per-record ValidationException), not the whole call.
		const rejectingSearchService: SearchService = {
			...baseSearchService,
			upsertVectors: async (records: VectorRecord[]) => {
				if (records.some((r) => r.metadata.messageId === badMsgId)) {
					throw new Error(
						"ValidationException: Metadata values must be strings, numbers, booleans, or arrays",
					);
				}
				return baseSearchService.upsertVectors(records);
			},
		};

		const services = createTestServices(storageService, rejectingSearchService);

		const result = await processBatch(
			[
				makeRecord(makeSearchIndexMessage({ messageId: goodMsgId }), "sqs-ok"),
				makeRecord(
					makeSearchIndexMessage({ messageId: badMsgId }),
					"sqs-poison",
				),
			],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "sqs-poison");

		const indexed = await store.query({
			vector: new Array(64).fill(0.1),
			topK: 100,
			filter: { accountConfigId: ACCOUNT_CONFIG_ID },
		});
		assert.ok(
			indexed.some((v) => v.metadata.messageId === goodMsgId),
			"the good sibling must still be indexed",
		);
		assert.ok(
			!indexed.some((v) => v.metadata.messageId === badMsgId),
			"the poison message must not be indexed",
		);

		threadMessages.clear();
		accounts.clear();
	});

	test("transient whole-call error fails every message in the batch (retry)", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const baseSearchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const msgId1 = "msg-throttle-1";
		const msgId2 = "msg-throttle-2";

		threadMessages.set(msgId1, makeThreadMessage(msgId1));
		threadMessages.set(msgId2, makeThreadMessage(msgId2));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: msgId1,
			parsed: { text: "Content one", html: null, attachments: [] },
		});
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: msgId2,
			parsed: { text: "Content two", html: null, attachments: [] },
		});

		// A throttle/5xx rejects every call, so both messages fail and retry.
		const throttlingSearchService: SearchService = {
			...baseSearchService,
			upsertVectors: async (_records: VectorRecord[]) => {
				throw new Error("ThrottlingException: rate exceeded");
			},
		};

		const services = createTestServices(
			storageService,
			throttlingSearchService,
		);

		const result = await processBatch(
			[
				makeRecord(makeSearchIndexMessage({ messageId: msgId1 }), "sqs-1"),
				makeRecord(makeSearchIndexMessage({ messageId: msgId2 }), "sqs-2"),
			],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 2);
		const failIds = result.batchItemFailures.map((f) => f.itemIdentifier);
		assert.ok(failIds.includes("sqs-1"));
		assert.ok(failIds.includes("sqs-2"));

		threadMessages.clear();
		accounts.clear();
	});

	test("failed upsert logs the messageId and error (fail loud, #913)", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const baseSearchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const msgId = "msg-loud-1";
		threadMessages.set(msgId, makeThreadMessage(msgId));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: msgId,
			parsed: {
				text: "Content for loud logging",
				html: null,
				attachments: [],
			},
		});

		const failingSearchService: SearchService = {
			...baseSearchService,
			upsertVectors: async (_records: VectorRecord[]) => {
				throw new Error(
					"ValidationException: Metadata values must be strings, numbers, booleans, or arrays",
				);
			},
		};

		const errorLogs: { message: string; context: Record<string, unknown> }[] =
			[];
		const capturingLogger = {
			...noopLogger,
			info: () => {},
			error: (message: string, context?: Record<string, unknown>) => {
				errorLogs.push({ message, context: context ?? {} });
			},
		} as unknown as Parameters<typeof processBatch>[2];

		const services = createTestServices(storageService, failingSearchService);

		const result = await processBatch(
			[makeRecord(makeSearchIndexMessage({ messageId: msgId }), "sqs-loud-1")],
			services,
			capturingLogger,
		);

		assert.equal(result.batchItemFailures.length, 1);

		const upsertFailure = errorLogs.find((l) => l.message === "Upsert failed");
		assert.ok(upsertFailure, "must log an Upsert failed entry");
		assert.equal(
			upsertFailure.context.messageId,
			msgId,
			"the failing messageId must be logged so the dead-letter is diagnosable",
		);
		assert.match(
			String(upsertFailure.context.error),
			/ValidationException/,
			"the actual upsert error must be logged",
		);

		threadMessages.clear();
		accounts.clear();
	});

	test("preparation failure for one record does not abort batch", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const goodMsgId = "msg-good";
		const badMsgId = "msg-bad";

		threadMessages.set(goodMsgId, makeThreadMessage(goodMsgId));
		threadMessages.set(badMsgId, makeThreadMessage(badMsgId));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: goodMsgId,
			parsed: { text: "Good content", html: null, attachments: [] },
		});

		const failingStorageService: StorageService = {
			...storageService,
			retrieveParsedBody: async (accountConfigId, accountId, messageId) => {
				if (messageId === badMsgId) {
					throw new Error("Simulated S3 failure");
				}
				return storageService.retrieveParsedBody(
					accountConfigId,
					accountId,
					messageId,
				);
			},
		};

		const services = createTestServices(failingStorageService, searchService);

		const goodRecord = makeRecord(
			makeSearchIndexMessage({ messageId: goodMsgId }),
			"sqs-good",
		);
		const badRecord = makeRecord(
			makeSearchIndexMessage({ messageId: badMsgId }),
			"sqs-bad",
		);

		const result = await processBatch(
			[goodRecord, badRecord],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "sqs-bad");
		assert.ok(store.size() > 0, "Good message should still be indexed");

		threadMessages.clear();
		accounts.clear();
	});

	test("two accounts produce separate upsertVectors calls (no cross-account mixing)", async () => {
		const ACCOUNT_ID_2 = "test-account-id-2";
		const ACCOUNT_CONFIG_ID_2 = "test-account-config-id-2";
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		accounts.set(ACCOUNT_ID_2, { accountId: ACCOUNT_ID_2 });

		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const baseSearchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		const msgId1 = "msg-acct1";
		const msgId2 = "msg-acct2";

		const tm1 = makeThreadMessage(msgId1);
		const tm2 = {
			...makeThreadMessage(msgId2),
			accountConfigId: ACCOUNT_CONFIG_ID_2,
		};
		threadMessages.set(msgId1, tm1);
		threadMessages.set(msgId2, tm2);

		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: msgId1,
			parsed: { text: "Account one content", html: null, attachments: [] },
		});
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID_2,
			accountId: ACCOUNT_ID_2,
			messageId: msgId2,
			parsed: { text: "Account two content", html: null, attachments: [] },
		});

		const upsertCallArgs: VectorRecord[][] = [];
		const trackingSearchService: SearchService = {
			...baseSearchService,
			upsertVectors: async (records: VectorRecord[]) => {
				upsertCallArgs.push(records);
				return baseSearchService.upsertVectors(records);
			},
		};

		const mockAccountService2 = {
			get: async (accountId: string) => {
				const account = accounts.get(accountId);
				if (!account)
					throw new NotFoundError(`Account not found: ${accountId}`);
				return account;
			},
		} as Services["accountService"];

		const services = createTestServices(
			storageService,
			trackingSearchService,
			mockAccountService2,
		);

		const result = await processBatch(
			[
				makeRecord(
					makeSearchIndexMessage({ messageId: msgId1, accountId: ACCOUNT_ID }),
				),
				makeRecord(
					makeSearchIndexMessage({
						messageId: msgId2,
						accountId: ACCOUNT_ID_2,
					}),
				),
			],
			services,
			noopLogger,
		);

		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(
			upsertCallArgs.length,
			2,
			"Should make separate upsertVectors calls per account",
		);
		const acct1Vectors = upsertCallArgs
			.flat()
			.filter((v) => v.metadata.accountConfigId === ACCOUNT_CONFIG_ID);
		const acct2Vectors = upsertCallArgs
			.flat()
			.filter((v) => v.metadata.accountConfigId === ACCOUNT_CONFIG_ID_2);
		assert.ok(acct1Vectors.length > 0, "Account 1 should have vectors");
		assert.ok(acct2Vectors.length > 0, "Account 2 should have vectors");
		for (const call of upsertCallArgs) {
			const configIds = new Set(call.map((v) => v.metadata.accountConfigId));
			assert.equal(
				configIds.size,
				1,
				"Each upsertVectors call should contain only one account's vectors",
			);
		}

		threadMessages.clear();
		accounts.clear();
	});

	test("idempotent re-delivery: re-indexing same message replaces vectors", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: MESSAGE_ID,
			parsed: { text: "Original content", html: null, attachments: [] },
		});

		const services = createTestServices(storageService, searchService);
		const msg = makeSearchIndexMessage({ messageId: MESSAGE_ID });

		await processBatch([makeRecord(msg)], services, noopLogger);
		const countAfterFirst = store.size();
		assert.ok(countAfterFirst > 0, "Should have vectors after first index");

		const result = await processBatch([makeRecord(msg)], services, noopLogger);
		assert.equal(result.batchItemFailures.length, 0);
		assert.equal(
			store.size(),
			countAfterFirst,
			"Vector count should be same after re-delivery",
		);

		threadMessages.clear();
		accounts.clear();
	});

	test("INSERT is dropped when account is deleted (tombstone fence)", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID, deletedAt: Date.now() });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: MESSAGE_ID,
			parsed: {
				text: "This should not be indexed",
				html: null,
				attachments: [],
			},
		});

		const services = createTestServices(storageService, searchService);
		const msg = makeSearchIndexMessage({ messageId: MESSAGE_ID });

		const result = await processBatch([makeRecord(msg)], services, noopLogger);

		assert.equal(
			result.batchItemFailures.length,
			0,
			"should not report failure",
		);
		assert.equal(
			store.size(),
			0,
			"should not index anything for deleted account",
		);

		threadMessages.clear();
		accounts.clear();
	});

	test("MODIFY event re-indexes the message", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));
		await storageService.storeParsedBody({
			accountConfigId: ACCOUNT_CONFIG_ID,
			accountId: ACCOUNT_ID,
			messageId: MESSAGE_ID,
			parsed: { text: "Modified content", html: null, attachments: [] },
		});

		const services = createTestServices(storageService, searchService);
		const msg = makeSearchIndexMessage({
			messageId: MESSAGE_ID,
			eventName: "MODIFY",
		});

		const result = await processBatch([makeRecord(msg)], services, noopLogger);

		assert.equal(result.batchItemFailures.length, 0);
		assert.ok(store.size() > 0, "MODIFY should re-index vectors");

		threadMessages.clear();
		accounts.clear();
	});

	test("a malformed body is fatal — crashes the batch instead of mis-routing", async () => {
		accounts.set(ACCOUNT_ID, { accountId: ACCOUNT_ID });
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));

		const services = createTestServices(storageService, searchService);
		// Valid JSON that fails the schema (would mis-route if not validated) and
		// a non-JSON body. Both are producer contract violations: parsing is left
		// uncaught so the batch crashes loud rather than silently dead-lettering.
		const garbage = makeRawRecord(
			JSON.stringify({ foo: "bar", messageId: MESSAGE_ID }),
			"sqs-garbage",
		);
		const notJson = makeRawRecord("not-json-at-all", "sqs-notjson");

		await assert.rejects(() => processBatch([garbage], services, noopLogger));
		await assert.rejects(() => processBatch([notJson], services, noopLogger));
		assert.equal(store.size(), 0, "no vectors written for malformed bodies");

		threadMessages.clear();
		accounts.clear();
	});

	test("non-NotFoundError from accountService.get is reported as failure (retried)", async () => {
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));

		const throwingAccountService = {
			get: async (
				_accountId: string,
			): Promise<{ accountId: string; deletedAt?: number }> => {
				throw new Error("AccessDenied: throttled");
			},
		} as Services["accountService"];

		const services = createTestServices(
			storageService,
			searchService,
			throwingAccountService,
		);
		const msg = makeSearchIndexMessage({ messageId: MESSAGE_ID });

		const result = await processBatch(
			[makeRecord(msg, "sqs-throttle")],
			services,
			noopLogger,
		);

		assert.equal(
			result.batchItemFailures.length,
			1,
			"transient account error must be retried, not swallowed",
		);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "sqs-throttle");
		assert.equal(store.size(), 0, "no vectors written on failure");

		threadMessages.clear();
	});

	test("NotFoundError from accountService.get skips without failure", async () => {
		accounts.clear();
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService();
		const searchService = createSearchService({ embedder, store });
		const storageService = createMockStorageService();

		threadMessages.set(MESSAGE_ID, makeThreadMessage(MESSAGE_ID));

		const services = createTestServices(storageService, searchService);
		const msg = makeSearchIndexMessage({ messageId: MESSAGE_ID });

		const result = await processBatch(
			[makeRecord(msg, "sqs-notfound")],
			services,
			noopLogger,
		);

		assert.equal(
			result.batchItemFailures.length,
			0,
			"genuine missing account is skipped, not failed",
		);
		assert.equal(store.size(), 0, "no vectors written for missing account");

		threadMessages.clear();
	});
});
