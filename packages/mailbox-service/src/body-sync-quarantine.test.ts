/**
 * The boundary this feature lives or dies on (issue #72).
 *
 * A message the parser refuses is set aside and stops being requeued. Storage
 * and database failures — which the same per-message frame catches — keep
 * propagating to the requeue path, because recording one as a quarantine would
 * tell the user that mail Remit could not reach was mail Remit could not read,
 * and let go of it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IQuarantineRepository,
	IThreadMessageRepository,
	MessageItem,
	QuarantineItem,
	QuarantineUpsertInput,
	UpdateMessageInput,
} from "@remit/data-ports";
import { MessageCategory } from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import { QuarantineService } from "./quarantine.js";

const UNPARSEABLE = Symbol("unparseable");

const buildHarness = (options: {
	retrieve?: (key: string) => Promise<Buffer>;
	existing?: QuarantineItem[];
}) => {
	const writes: QuarantineUpsertInput[] = [];
	const messageUpdates: string[] = [];

	const message: MessageItem = {
		messageId: "m-1",
		mailboxId: "mbx-1",
		uid: 40217,
		rfc822Size: 2048,
		messageIdHeader: "<abc@example.com>",
		bodyStorageKey: "s3://bodies/m-1",
		category: MessageCategory.uncategorized,
	} as MessageItem;

	const messageService = {
		get: async () => message,
		update: async (messageId: string, _input: UpdateMessageInput) => {
			messageUpdates.push(messageId);
		},
	} as unknown as IMessageRepository;

	const storageService = {
		retrieve:
			options.retrieve ??
			(async () => {
				throw new Error("no body configured");
			}),
	} as unknown as StorageService;

	const envelopeService = {
		getMessageData: async () => ({ bodyPart: [], bodyPartParameter: [] }),
	} as unknown as IEnvelopeRepository;

	const repository = {
		listByAccountConfigId: async () => options.existing ?? [],
		upsert: async (input: QuarantineUpsertInput) => {
			writes.push(input);
		},
	} satisfies IQuarantineRepository;

	const service = new BodySyncService(
		messageService,
		storageService,
		{
			getByMessageId: async () => ({
				threadMessageId: "tm-1",
				sentDate: 1,
				mailboxId: "mbx-1",
				isRead: false,
				isDeleted: false,
				hasStars: false,
				hasAttachment: false,
			}),
			update: async () => {},
		} as unknown as IThreadMessageRepository,
		{} as unknown as IAddressRepository,
		envelopeService,
		{ info: () => {}, error: () => {}, debug: () => {} },
		undefined,
		undefined,
		{
			quarantineService: new QuarantineService(
				repository,
				{
					listByMailboxId: async () => [],
				} as unknown as IMailboxSpecialUseRepository,
				"sha-abc",
				{ info: () => {}, warn: () => {} },
			),
			mailboxId: "mbx-1",
			uidValidity: 1_712_000_000,
			attempts: 2,
		},
	);

	return { service, writes, messageUpdates };
};

const sync = (service: BodySyncService) =>
	service.syncBodies(["m-1"], "acc-1", "cfg-1", "INBOX", async () => {
		throw new Error("this test must not open IMAP");
	});

describe("body sync quarantines a message the parser refuses", () => {
	const retrieveUnparseable = async () => UNPARSEABLE as unknown as Buffer;

	it("records the failure instead of requeueing the message forever", async () => {
		const harness = buildHarness({ retrieve: retrieveUnparseable });

		const result = await sync(harness.service);

		assert.equal(harness.writes.length, 1);
		assert.deepEqual(result.failedMessageIds, []);
	});

	it("names the message by uid and UIDVALIDITY, so the record is idempotent", async () => {
		const harness = buildHarness({ retrieve: retrieveUnparseable });

		await sync(harness.service);

		assert.equal(harness.writes[0]?.uid, 40217);
		assert.equal(harness.writes[0]?.uidValidity, 1_712_000_000);
		assert.equal(harness.writes[0]?.failureStage, "BodyParse");
	});

	it("does not mark the message synced — it was set aside, not applied", async () => {
		const harness = buildHarness({ retrieve: retrieveUnparseable });

		const result = await sync(harness.service);

		assert.deepEqual(result.syncedMessageIds, []);
		assert.deepEqual(harness.messageUpdates, []);
	});
});

describe("body sync leaves infrastructure failures alone", () => {
	it("requeues a storage failure rather than calling the message unreadable", async () => {
		const harness = buildHarness({
			retrieve: async () => {
				throw new Error("S3 503 SlowDown");
			},
		});

		const result = await sync(harness.service);

		assert.deepEqual(harness.writes, []);
		assert.deepEqual(result.failedMessageIds, ["m-1"]);
	});

	it("requeues a database failure the same way", async () => {
		const harness = buildHarness({
			retrieve: async () => {
				const error = new Error("ProvisionedThroughputExceededException");
				error.name = "ProvisionedThroughputExceededException";
				throw error;
			},
		});

		const result = await sync(harness.service);

		assert.deepEqual(harness.writes, []);
		assert.deepEqual(result.failedMessageIds, ["m-1"]);
	});
});

describe("body sync skips what is already quarantined", () => {
	it("does not fetch or re-parse a uid already set aside", async () => {
		const harness = buildHarness({
			existing: [
				{
					mailboxId: "mbx-1",
					uidValidity: 1_712_000_000,
					uid: 40217,
				} as QuarantineItem,
			],
			retrieve: async () => {
				throw new Error("a quarantined message must not be read again");
			},
		});

		const result = await sync(harness.service);

		assert.equal(result.skippedCount, 1);
		assert.deepEqual(harness.writes, []);
	});
});
