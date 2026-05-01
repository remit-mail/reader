import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AddressService,
	type MessageService,
	type ThreadMessageService,
	type UpdateMessageInput,
} from "@remit/remit-electrodb-service";
import { MessageCategory } from "@remit/domain-enums";
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

const NEWSLETTER_EML = Buffer.from(
	[
		"From: news@news.example.com",
		"To: bob@example.com",
		"Subject: weekly digest",
		"Message-ID: <news-1@news.example.com>",
		"List-Id: <weekly.news.example.com>",
		"List-Unsubscribe: <https://news.example.com/u>",
		"Content-Type: text/plain",
		"",
		"weekly digest body",
		"",
	].join("\r\n"),
);

interface FakeStateOptions {
	messageId: string;
	hasBodyStorageKey?: boolean;
	rawEml?: Buffer;
}

const buildFakeState = (opts: FakeStateOptions) => {
	const storedBodies: StoreMessageBodyParams[] = [];
	const storedParsed: StoreParsedBodyParams[] = [];
	const updatedKeys: Array<{ messageId: string } & UpdateMessageInput> = [];
	const inboundIncrements: Array<{ addressId: string; now: number }> = [];

	const message = {
		messageId: opts.messageId,
		mailboxId: "mbx-1",
		uid: 42,
		messageIdHeader: "<abc@example.com>",
		bodyStorageKey: opts.hasBodyStorageKey
			? "s3://bucket/accounts/acc-cfg-1/acc-1/messages/msg-1/body.eml"
			: undefined,
	};

	const messageService = {
		get: async (id: string) => {
			assert.equal(id, opts.messageId);
			return message;
		},
		update: async (id: string, input: UpdateMessageInput): Promise<unknown> => {
			updatedKeys.push({ messageId: id, ...input });
			if (input.bodyStorageKey) {
				message.bodyStorageKey = input.bodyStorageKey;
			}
			return message;
		},
	} as unknown as MessageService;

	const addressService = {
		incrementInboundCount: async (addressId: string, now: number) => {
			inboundIncrements.push({ addressId, now });
		},
	} as unknown as AddressService;

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
				uri: `s3://bucket/accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/body.eml`,
				storageType: "s3",
				storageLocation: "bucket",
				storageKey: `accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/body.eml`,
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
				uri: `s3://bucket/accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/parsed.json.gz`,
				storageType: "s3",
				storageLocation: "bucket",
				storageKey: `accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/parsed.json.gz`,
				sizeBytes: 0,
				checksumSha256: "x",
				contentEncoding: "gzip",
			};
		},
		retrieveParsedBody: async () => null,
		retrieve: async () => opts.rawEml ?? A_RAW_EML,
		exists: async () => true,
		delete: async () => {},
	};

	return {
		messageService,
		threadMessageService,
		storageService,
		addressService,
		storedBodies,
		storedParsed,
		updatedKeys,
		inboundIncrements,
	};
};

const buildFakeConnection = (rawEml?: Buffer): IImapConnection => {
	return {
		openBox: async () => ({}),
		fetchMessageBody: async () => rawEml ?? A_RAW_EML,
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
			fake.addressService,
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
		assert.equal(cached.accountConfigId, "acc-cfg-1");
		assert.equal(cached.accountId, "acc-1");
		assert.equal(cached.messageId, "msg-1");
		assert.equal(typeof cached.parsed.text, "string");
		assert.ok(cached.parsed.text?.includes("hello world body"));
		assert.ok(Array.isArray(cached.parsed.attachments));
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
			fake.addressService,
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

describe("BodySyncService.syncBodies (classification + counters)", () => {
	it("persists Message.category and increments inbound counter on the From Address", async () => {
		const fake = buildFakeState({ messageId: "msg-1" });
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
		);

		const before = Date.now();
		await service.syncBodies(
			["msg-1"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(),
		);
		const after = Date.now();

		const categoryUpdate = fake.updatedKeys.find(
			(u) => u.category !== undefined,
		);
		assert.ok(categoryUpdate, "expected a Message.category update");
		assert.equal(categoryUpdate.category, MessageCategory.personal);

		assert.equal(fake.inboundIncrements.length, 1);
		const expectedAddressId = AddressService.generateAddressId(
			"acc-cfg-1",
			"a@example.com",
		);
		assert.equal(fake.inboundIncrements[0].addressId, expectedAddressId);
		assert.ok(fake.inboundIncrements[0].now >= before);
		assert.ok(fake.inboundIncrements[0].now <= after);
	});

	it("classifies a List-Id + List-Unsubscribe message as newsletter", async () => {
		const fake = buildFakeState({
			messageId: "msg-2",
			rawEml: NEWSLETTER_EML,
		});
		const service = new BodySyncService(
			fake.messageService,
			fake.storageService,
			fake.threadMessageService,
			fake.addressService,
		);

		await service.syncBodies(
			["msg-2"],
			"acc-1",
			"acc-cfg-1",
			"INBOX",
			async () => buildFakeConnection(NEWSLETTER_EML),
		);

		const categoryUpdate = fake.updatedKeys.find(
			(u) => u.category !== undefined,
		);
		assert.ok(categoryUpdate, "expected a Message.category update");
		assert.equal(categoryUpdate.category, MessageCategory.newsletter);
	});
});
