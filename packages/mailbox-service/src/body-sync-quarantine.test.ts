/**
 * The boundary this feature lives or dies on (issue #72).
 *
 * A message the parser refuses is set aside and stops being requeued. Storage
 * and database failures — which the same per-message frame catches — keep
 * propagating to the requeue path, because recording one as a quarantine would
 * tell the user that mail Remit could not reach was mail Remit could not read,
 * and let go of it. That discrimination is the `error instanceof BodyParseError`
 * branch in `syncBodies`' stream loop, and these tests drive it there.
 *
 * The parse cases inject the `BodyParseError` at the storage write rather than
 * feeding mailparser bytes it refuses: mailparser accepts every byte sequence a
 * test can construct, and the branch under test asks only what type of error
 * reached it. That only `parseMessageBody` ever constructs one — so an instance
 * of it really is proof the message and not the infrastructure failed — is
 * pinned in `body-parse.test.ts`.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
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
import { NotFoundError } from "@remit/data-ports/errors";
import { MessageCategory } from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodyParseError } from "./body-parse.js";
import { BodySyncService } from "./body-sync.js";
import { QuarantineService } from "./quarantine.js";
import type { IImapConnection } from "./types.js";

const WELL_FORMED = Buffer.from(
	[
		"From: someone@example.com",
		"To: me@example.com",
		"Subject: hello",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

const buildHarness = (options: {
	existing?: QuarantineItem[];
	storeBodyFails?: unknown;
	storeParsedFails?: unknown;
	upsertFails?: boolean;
}) => {
	const writes: QuarantineUpsertInput[] = [];
	const messageUpdates: string[] = [];

	const message: MessageItem = {
		messageId: "m-1",
		mailboxId: "mbx-1",
		uid: 40217,
		rfc822Size: 2048,
		messageIdHeader: "<abc@example.com>",
		category: MessageCategory.uncategorized,
		classificationState: "NotExamined",
	} as MessageItem;

	const messageService = {
		get: async () => message,
		update: async (messageId: string, _input: UpdateMessageInput) => {
			messageUpdates.push(messageId);
		},
	} as unknown as IMessageRepository;

	const storageService = {
		retrieve: async () => {
			throw new Error("the sync path never reads a body back");
		},
		storeMessageBodyStream: async () => {
			if (options.storeBodyFails !== undefined) throw options.storeBodyFails;
			return { uri: "s3://bodies/m-1" };
		},
		storeParsedBody: async () => {
			if (options.storeParsedFails !== undefined)
				throw options.storeParsedFails;
		},
		listBodyParts: async () => [],
	} as unknown as StorageService;

	const envelopeService = {
		getMessageData: async () => ({ bodyPart: [], bodyPartParameter: [] }),
		listBodyParts: async () => [],
	} as unknown as IEnvelopeRepository;

	const addressService = {
		getAddress: async () => {
			throw new NotFoundError("Address not found");
		},
		incrementInboundCount: async () => {},
	} as unknown as IAddressRepository;

	const repository = {
		listByAccountConfigId: async () => options.existing ?? [],
		upsert: async (input: QuarantineUpsertInput) => {
			if (options.upsertFails) throw new Error("database unavailable");
			writes.push(input);
		},
	} satisfies IQuarantineRepository;

	const service = new BodySyncService(
		messageService,
		storageService,
		{
			findAllByMessageId: async () => [
				{
					threadMessageId: "tm-1",
					sentDate: 1,
					mailboxId: "mbx-1",
					isRead: false,
					isDeleted: false,
					hasStars: false,
					hasAttachment: false,
				},
			],
			update: async () => {},
		} as unknown as IThreadMessageRepository,
		addressService,
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

const connection = () =>
	({
		openBox: async () => {},
		async *fetchMessageBodies(uids: number[]) {
			for (const uid of uids) {
				yield { uid, source: Readable.from([WELL_FORMED]) };
			}
		},
	}) as unknown as IImapConnection;

const sync = (service: BodySyncService) =>
	service.syncBodies(["m-1"], "acc-1", "cfg-1", "INBOX", async () =>
		connection(),
	);

const parseRefusal = () =>
	new BodyParseError(new Error("boundary never closed"));

describe("body sync quarantines a message the parser refuses", () => {
	it("records the failure instead of requeueing the message forever", async () => {
		const harness = buildHarness({ storeBodyFails: parseRefusal() });

		const result = await sync(harness.service);

		assert.equal(harness.writes.length, 1);
		assert.deepEqual(result.failedMessageIds, []);
	});

	it("names the message by uid and UIDVALIDITY, so the record is idempotent", async () => {
		const harness = buildHarness({ storeBodyFails: parseRefusal() });

		await sync(harness.service);

		assert.equal(harness.writes[0]?.uid, 40217);
		assert.equal(harness.writes[0]?.uidValidity, 1_712_000_000);
		assert.equal(harness.writes[0]?.failureStage, "BodyParse");
	});

	it("does not mark the message synced — it was set aside, not applied", async () => {
		const harness = buildHarness({ storeBodyFails: parseRefusal() });

		const result = await sync(harness.service);

		assert.deepEqual(result.syncedMessageIds, []);
		assert.deepEqual(harness.messageUpdates, []);
	});
});

describe("body sync leaves infrastructure failures alone", () => {
	it("requeues a storage failure rather than calling the message unreadable", async () => {
		const harness = buildHarness({
			storeBodyFails: new Error("S3 503 SlowDown"),
		});

		const result = await sync(harness.service);

		assert.deepEqual(harness.writes, []);
		assert.deepEqual(result.failedMessageIds, ["m-1"]);
	});

	it("requeues a database failure the same way, parse already past", async () => {
		const throughput = new Error("ProvisionedThroughputExceededException");
		throughput.name = "ProvisionedThroughputExceededException";
		const harness = buildHarness({ storeParsedFails: throughput });

		// The body parsed cleanly and the failure came after it, so nothing here
		// may say the message is unreadable.
		const result = await sync(harness.service);

		assert.deepEqual(harness.writes, []);
		assert.deepEqual(result.failedMessageIds, ["m-1"]);
	});
});

describe("body sync contains a failure to write the record", () => {
	it("requeues the message instead of aborting the batch", async () => {
		const harness = buildHarness({
			storeBodyFails: parseRefusal(),
			upsertFails: true,
		});

		// Writing the record is database work, so its failure is infrastructure:
		// the message keeps its place in the queue rather than being let go of
		// with nothing written down, and the rest of the batch is unaffected.
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
		});

		const result = await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => {
				throw new Error("a quarantined message must not be fetched again");
			},
		);

		assert.equal(result.skippedCount, 1);
		assert.deepEqual(result.failedMessageIds, []);
		assert.deepEqual(harness.writes, []);
		assert.deepEqual(harness.messageUpdates, []);
	});
});
