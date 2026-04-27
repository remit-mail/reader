import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type {
	StorageReference,
	StorageService,
	StoreMessageBodyParams,
	StoreParsedBodyParams,
} from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import type { IImapConnection } from "./types.js";

const A_RAW_EML = Buffer.from(
	[
		"From: a@example.com",
		"To: b@example.com",
		"Subject: hi",
		"Message-ID: <abc@example.com>",
		"Content-Type: text/plain",
		"",
		"hello world body",
		"",
	].join("\r\n"),
);

interface FakeStateOptions {
	messageId: string;
	hasBodyStorageKey?: boolean;
}

const buildFakeState = (opts: FakeStateOptions) => {
	const storedBodies: StoreMessageBodyParams[] = [];
	const storedParsed: StoreParsedBodyParams[] = [];
	const updatedKeys: Array<{ messageId: string; bodyStorageKey?: string }> = [];

	const message = {
		messageId: opts.messageId,
		mailboxId: "mbx-1",
		uid: 42,
		messageIdHeader: "<abc@example.com>",
		bodyStorageKey: opts.hasBodyStorageKey
			? "s3://bucket/accounts/acc-1/messages/msg-1/body.eml"
			: undefined,
	};

	const messageService = {
		get: async (id: string) => {
			assert.equal(id, opts.messageId);
			return message;
		},
		update: async (
			id: string,
			input: { bodyStorageKey?: string },
		): Promise<unknown> => {
			updatedKeys.push({ messageId: id, ...input });
			if (input.bodyStorageKey) {
				message.bodyStorageKey = input.bodyStorageKey;
			}
			return message;
		},
	} as unknown as MessageService;

	const threadMessageService = {
		getByMessageId: async () => ({
			threadMessageId: "tm-1",
			messageId: opts.messageId,
		}),
		update: async () => ({}),
	} as unknown as ThreadMessageService;

	const storageService: StorageService = {
		storeMessageBody: async (params): Promise<StorageReference> => {
			storedBodies.push(params);
			return {
				uri: `s3://bucket/accounts/${params.accountId}/messages/${params.messageId}/body.eml`,
				storageType: "s3",
				storageLocation: "bucket",
				storageKey: `accounts/${params.accountId}/messages/${params.messageId}/body.eml`,
				sizeBytes: params.content.length,
				checksumSha256: "x",
				contentEncoding: "gzip",
			};
		},
		storeBodyPart: async () => {
			throw new Error("not used");
		},
		storeDeduplicated: async () => {
			throw new Error("not used");
		},
		storeParsedBody: async (params): Promise<StorageReference> => {
			storedParsed.push(params);
			return {
				uri: `s3://bucket/accounts/${params.accountId}/messages/${params.messageId}/parsed.json.gz`,
				storageType: "s3",
				storageLocation: "bucket",
				storageKey: `accounts/${params.accountId}/messages/${params.messageId}/parsed.json.gz`,
				sizeBytes: 0,
				checksumSha256: "x",
				contentEncoding: "gzip",
			};
		},
		retrieveParsedBody: async () => null,
		retrieve: async () => A_RAW_EML,
		exists: async () => true,
		delete: async () => {},
	};

	return {
		messageService,
		threadMessageService,
		storageService,
		storedBodies,
		storedParsed,
		updatedKeys,
	};
};

const buildFakeConnection = (): IImapConnection => {
	return {
		openBox: async () => ({}),
		fetchMessageBody: async () => A_RAW_EML,
		// Other interface methods are unused in these tests; cast to avoid
		// implementing the entire IMAP surface.
	} as unknown as IImapConnection;
};

describe("BodySyncService.syncBodies (parsed-body cache)", () => {
	it("writes BOTH body.eml and parsed.json.gz on a successful body fetch", async () => {
		const fake = buildFakeState({ messageId: "msg-1" });
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
		);

		const result = await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		assert.equal(result.syncedCount, 1);
		assert.equal(fake.storedBodies.length, 1);
		assert.equal(fake.storedParsed.length, 1);

		const cached = fake.storedParsed[0];
		assert.equal(cached.accountId, "acc-1");
		assert.equal(cached.messageId, "msg-1");
		assert.equal(typeof cached.parsed.text, "string");
		assert.ok(cached.parsed.text?.includes("hello world body"));
		assert.ok(Array.isArray(cached.parsed.attachments));
	});

	it("forwards parsed message to the search indexer when configured", async () => {
		const fake = buildFakeState({ messageId: "msg-1" });
		const indexed: Array<{ messageId: string; accountConfigId: string }> = [];
		const indexer = {
			indexMessage: async (input: {
				messageId: string;
				accountConfigId: string;
			}): Promise<void> => {
				indexed.push({
					messageId: input.messageId,
					accountConfigId: input.accountConfigId,
				});
			},
		};
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			undefined,
			indexer,
		);

		const result = await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		assert.equal(result.syncedCount, 1);
		assert.equal(indexed.length, 1);
		assert.equal(indexed[0].messageId, "msg-1");
		assert.equal(indexed[0].accountConfigId, "acc-cfg-1");
	});

	it("does not fail body sync when the search indexer throws", async () => {
		const fake = buildFakeState({ messageId: "msg-1" });
		const indexer = {
			indexMessage: async (): Promise<void> => {
				throw new Error("simulated bedrock outage");
			},
		};
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			undefined,
			indexer,
		);

		const result = await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		assert.equal(result.syncedCount, 1);
		assert.equal(fake.storedBodies.length, 1);
	});

	it("does not fail the whole body sync when parsed-cache write throws", async () => {
		const fake = buildFakeState({ messageId: "msg-1" });
		const failingStorage: StorageService = {
			...fake.storageService,
			storeParsedBody: async () => {
				throw new Error("simulated S3 outage");
			},
		};
		const service = new BodySyncService(
			fake.messageService,
			failingStorage,
			fake.threadMessageService,
		);

		const result = await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);

		assert.equal(result.syncedCount, 1);
		assert.equal(fake.storedBodies.length, 1);
	});
});
