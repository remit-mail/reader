/**
 * `Address.flags.category` overrides classification at sync time (issue #299,
 * RFC 039 Decision 3, closing item 3 of RFC 039). A user who has told Remit
 * "this sender is actually Personal, not Marketing" via the Reclassify dialog
 * (`PATCH /addresses/{id}`) gets that category on the sender's next message,
 * instead of `classifyByHeaders` re-deriving the same header-driven verdict
 * every time.
 *
 * The override sits behind the same `hasDecidedCategory` write-once gate #378
 * added for `Message.category` (RFC 034 Decision 3.1, RFC 030's message-list
 * GSI sort key depends on it never churning): a message already carrying a
 * real category is never re-touched, override present or not. The two tests
 * under "survives a re-entrant pass" feed a *differing* override to an
 * already-classified message through both shipped re-entry paths — the
 * `NoSuchKey` IMAP re-fetch and `syncBodies(..., force: true)` — so a
 * regression that let the override bypass the guard shows up here, not just
 * in an isolated unit check.
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type {
	AddressItem,
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	ThreadMessageItem,
	UpdateMessageInput,
	UpdateThreadMessageInput,
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
		"List-Unsubscribe: <https://www.linkedin.com/e/unsub>",
		"Content-Type: text/plain",
		"",
		"invitation",
	].join("\r\n"),
);

interface ThreadUpdate {
	threadMessageId: string;
	input: UpdateThreadMessageInput;
}

interface Harness {
	service: BodySyncService;
	message: MessageItem;
	rows: ThreadMessageItem[];
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
	threadUpdates: ThreadUpdate[];
	getAddressCalls: number;
}

const buildHarness = (
	message: Partial<MessageItem> & Pick<MessageItem, "messageId">,
	flags: AddressItem["flags"] | undefined,
	retrieve: () => Promise<Buffer> = async () => {
		throw new Error("no body configured for retrieve()");
	},
): Harness => {
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];
	const threadUpdates: ThreadUpdate[] = [];
	let getAddressCalls = 0;

	const messageRow = {
		uid: 1,
		mailboxId: "mb-1",
		category: MessageCategory.uncategorized,
		...message,
	} as unknown as MessageItem;

	const rows: ThreadMessageItem[] = [
		{
			threadMessageId: "tm-1",
			messageId: message.messageId,
			mailboxId: "mb-1",
			sentDate: 1,
			isRead: false,
			isDeleted: false,
			hasStars: false,
			hasAttachment: false,
			category: messageRow.category,
		} as unknown as ThreadMessageItem,
	];

	const messageService = {
		get: async () => messageRow,
		update: async (messageId: string, input: UpdateMessageInput) => {
			messageUpdates.push({ messageId, input });
			Object.assign(messageRow, input);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => rows,
		update: async (
			_accountConfigId: string,
			threadMessageId: string,
			input: UpdateThreadMessageInput,
		) => {
			threadUpdates.push({ threadMessageId, input });
			const row = rows.find((r) => r.threadMessageId === threadMessageId);
			if (row) Object.assign(row, input);
		},
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

	const addressService = {
		getAddress: async () => {
			getAddressCalls++;
			if (flags === undefined) {
				throw new NotFoundError("Address not found");
			}
			return { flags } as unknown as AddressItem;
		},
		incrementInboundCount: async () => {},
	} as unknown as IAddressRepository;

	const envelopeService = {
		listBodyParts: async () => [],
	} as unknown as IEnvelopeRepository;

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		{ info: () => {}, error: () => {} },
	);

	return {
		service,
		message: messageRow,
		rows,
		messageUpdates,
		threadUpdates,
		get getAddressCalls() {
			return getAddressCalls;
		},
	};
};

const noSuchKeyError = () =>
	Object.assign(new Error("missing"), { name: "NoSuchKey" });

const overrideFlags = (
	category: (typeof MessageCategory)[keyof typeof MessageCategory],
): AddressItem["flags"] =>
	({
		category: { value: category, setAt: 1_000 },
	}) as unknown as AddressItem["flags"];

describe("Address.flags.category overrides classification at sync time (issue #299)", () => {
	it("classifies a new message by the sender's override, not the header-derived category", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", category: MessageCategory.uncategorized },
			overrideFlags(MessageCategory.personal),
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
			MessageCategory.personal,
		);
		assert.equal(harness.message.category, MessageCategory.personal);
		// No placementConfig is wired in this harness, so the override's own
		// Address read is the only one classification makes per message.
		assert.equal(harness.getAddressCalls, 1);
	});

	it("denormalizes the override onto the ThreadMessage, matching the Message row", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", category: MessageCategory.uncategorized },
			overrideFlags(MessageCategory.personal),
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

		assert.equal(harness.rows[0].category, MessageCategory.personal);
	});

	it("classifies by headers as usual when the sender has no category override", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", category: MessageCategory.uncategorized },
			undefined,
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

		assert.equal(
			harness.messageUpdates[0].input.category,
			MessageCategory.social,
		);
	});

	it("classifies by headers as usual when the sender has flags but no category entry", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", category: MessageCategory.uncategorized },
			{ vip: { value: true, setAt: 1 } } as unknown as AddressItem["flags"],
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

		assert.equal(
			harness.messageUpdates[0].input.category,
			MessageCategory.social,
		);
	});

	it("backfillClassification picks up the same override for a body stored before classification existed", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				bodyStorageKey: "s3://bodies/m-1",
				category: MessageCategory.uncategorized,
			},
			overrideFlags(MessageCategory.transactional),
			async () => LINKEDIN_EML,
		);

		const result = await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => {
				throw new Error("backfill must not open IMAP");
			},
		);

		assert.equal(result.skippedCount, 1);
		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(
			harness.messageUpdates[0].input.category,
			MessageCategory.transactional,
		);
		assert.equal(harness.rows[0].category, MessageCategory.transactional);
	});

	describe("survives a re-entrant pass with a differing override already set", () => {
		it("keeps the already-decided category through the NoSuchKey IMAP re-fetch", async () => {
			const harness = buildHarness(
				{
					messageId: "m-1",
					bodyStorageKey: "s3://bodies/m-1",
					category: MessageCategory.marketing,
				},
				overrideFlags(MessageCategory.personal),
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
			assert.equal(harness.rows[0].category, MessageCategory.marketing);
		});

		it("keeps the already-decided category when syncBodies re-fetches with force", async () => {
			const harness = buildHarness(
				{
					messageId: "m-1",
					bodyStorageKey: "s3://bodies/m-1",
					category: MessageCategory.marketing,
				},
				overrideFlags(MessageCategory.personal),
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
			assert.equal(harness.rows[0].category, MessageCategory.marketing);
		});
	});

	it("propagates a non-NotFound Address lookup failure instead of silently classifying by headers", async () => {
		const message = {
			messageId: "m-1",
			category: MessageCategory.uncategorized,
		};
		const messageRow = { uid: 1, mailboxId: "mb-1", ...message } as MessageItem;

		const messageService = {
			get: async () => messageRow,
			update: async () => {},
		} as unknown as IMessageRepository;

		const threadMessageService = {
			findAllByMessageId: async () => [
				{
					threadMessageId: "tm-1",
					mailboxId: "mb-1",
					sentDate: 1,
					isRead: false,
					isDeleted: false,
					hasStars: false,
					hasAttachment: false,
				},
			],
			update: async () => {},
		} as unknown as IThreadMessageRepository;

		const storageService = {
			storeMessageBody: async () => ({ uri: "s3://bodies/m-1" }),
			storeParsedBody: async () => {},
			listBodyParts: async () => [],
		} as unknown as StorageService;

		const addressService = {
			getAddress: async () => {
				const error = new Error("ProvisionedThroughputExceededException");
				error.name = "ProvisionedThroughputExceededException";
				throw error;
			},
			incrementInboundCount: async () => {},
		} as unknown as IAddressRepository;

		const envelopeService = {
			listBodyParts: async () => [],
		} as unknown as IEnvelopeRepository;

		const service = new BodySyncService(
			messageService,
			storageService,
			threadMessageService,
			addressService,
			envelopeService,
			{ info: () => {}, error: () => {} },
		);

		const connection = {
			openBox: async () => {},
			fetchMessageBody: async () => LINKEDIN_EML,
		} as unknown as IImapConnection;

		await assert.rejects(
			service.fetchAndGetBody(
				"m-1",
				"acc-1",
				"cfg-1",
				"INBOX",
				async () => connection,
			),
			/ProvisionedThroughputExceededException/,
		);
	});
});
