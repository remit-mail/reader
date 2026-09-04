/**
 * The boundary this feature lives or dies on (issue #72): a uid already set
 * aside is never fetched, parsed or requeued again. The quarantine list is read
 * once per round, before anything else in the loop looks at the message, so a
 * message with no stored body — the one shape that would otherwise reach IMAP —
 * still never opens a connection.
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

const buildHarness = (options: { existing?: QuarantineItem[] }) => {
	const writes: QuarantineUpsertInput[] = [];
	const messageUpdates: string[] = [];

	const message: MessageItem = {
		messageId: "m-1",
		mailboxId: "mbx-1",
		uid: 40217,
		rfc822Size: 2048,
		messageIdHeader: "<abc@example.com>",
		category: MessageCategory.uncategorized,
	} as MessageItem;

	const messageService = {
		get: async () => message,
		update: async (messageId: string, _input: UpdateMessageInput) => {
			messageUpdates.push(messageId);
		},
	} as unknown as IMessageRepository;

	const storageService = {
		retrieve: async () => {
			throw new Error("a quarantined message must not be read again");
		},
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

		const result = await sync(harness.service);

		assert.equal(result.skippedCount, 1);
		assert.deepEqual(result.failedMessageIds, []);
		assert.deepEqual(harness.writes, []);
		assert.deepEqual(harness.messageUpdates, []);
	});
});
