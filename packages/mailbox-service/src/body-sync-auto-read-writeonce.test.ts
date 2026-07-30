/**
 * Issue #499: `Address.flags.unsubscribed` auto-mark-read is a first-
 * classification decision, like `Message.category` (#355) and the placement
 * verdict (#383). Re-deriving it on the two shipped re-entrant paths —
 * `fetchAndGetBody`'s `NoSuchKey` fallback and `syncBodies(..., force: true)`
 * — undid a user who had deliberately marked such a message unread.
 *
 * The re-entrant fixtures below keep `flags.unsubscribed` set, so a regression
 * that drops the guard shows up as a real `FlagQueueService.markAsRead`
 * round-trip against a message the user owns, not as a fixture that happens to
 * disagree with the flag.
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
	UpdateMessageInput,
} from "@remit/data-ports";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import type { FlagQueueService } from "./flag-queue.js";
import type { IImapConnection } from "./types.js";

const UNSUBSCRIBED_SENDER = "newsletter@example.com";

const PLAIN_EML = Buffer.from(
	[
		`From: Newsletter <${UNSUBSCRIBED_SENDER}>`,
		"To: me@example.com",
		"Subject: This week",
		"List-Unsubscribe: <mailto:stop@example.com>",
		"Content-Type: text/plain",
		"",
		"body",
	].join("\r\n"),
);

interface MarkReadCall {
	accountConfigId: string;
	messageId: string;
	accountId: string;
}

interface Harness {
	service: BodySyncService;
	markReadCalls: MarkReadCall[];
}

const buildHarness = (
	message: Partial<MessageItem> & Pick<MessageItem, "messageId">,
	retrieve: () => Promise<Buffer>,
): Harness => {
	const markReadCalls: MarkReadCall[] = [];

	const messageRow = {
		uid: 1,
		mailboxId: "mb-inbox",
		...message,
	} as unknown as MessageItem;

	const messageService = {
		get: async () => messageRow,
		update: async (_messageId: string, input: UpdateMessageInput) => {
			Object.assign(messageRow, input);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => [
			{
				threadMessageId: "tm-1",
				messageId: message.messageId,
				mailboxId: messageRow.mailboxId,
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
		retrieve,
		storeMessageBody: async () => ({ uri: `s3://bodies/${message.messageId}` }),
		storeMessageBodyStream: async () => ({
			uri: `s3://bodies/${message.messageId}`,
		}),
		storeParsedBody: async () => {},
		listBodyParts: async () => [],
	} as unknown as StorageService;

	const addressService = {
		getAddress: async () =>
			({
				flags: { unsubscribed: { value: true, setAt: 1 } },
			}) as unknown as AddressItem,
		incrementInboundCount: async () => {},
	} as unknown as IAddressRepository;

	const envelopeService = {
		listBodyParts: async () => [],
	} as unknown as IEnvelopeRepository;

	const flagQueueService = {
		markAsRead: async (
			accountConfigId: string,
			messageId: string,
			accountId: string,
		) => {
			markReadCalls.push({ accountConfigId, messageId, accountId });
		},
	} as unknown as FlagQueueService;

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		envelopeService,
		{ info: () => {}, error: () => {} },
		undefined,
		undefined,
		undefined,
		{ flagQueueService },
	);

	return { service, markReadCalls };
};

const noSuchKeyError = () =>
	Object.assign(new Error("missing"), { name: "NoSuchKey" });

const bodyConnection = () =>
	({
		openBox: async () => {},
		fetchMessageBody: async () => PLAIN_EML,
		async *fetchMessageBodies(uids: number[]) {
			for (const uid of uids) {
				yield { uid, source: Readable.from([PLAIN_EML]) };
			}
		},
	}) as unknown as IImapConnection;

describe("unsubscribed auto-mark-read is decided once (issue #499)", () => {
	it("marks a message read on the pass that first classifies it", async () => {
		const harness = buildHarness({ messageId: "m-1" }, async () => {
			throw new Error("no body stored yet; must not retrieve");
		});

		await harness.service.fetchAndGetBody(
			"m-1",
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => bodyConnection(),
		);

		assert.deepEqual(harness.markReadCalls, [
			{ accountConfigId: "cfg-1", messageId: "m-1", accountId: "acc-1" },
		]);
	});

	it("leaves a manually-unread message alone through the NoSuchKey IMAP re-fetch", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", bodyStorageKey: "s3://bodies/m-1" },
			async () => {
				throw noSuchKeyError();
			},
		);

		await harness.service.fetchAndGetBody(
			"m-1",
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => bodyConnection(),
		);

		assert.deepEqual(
			harness.markReadCalls,
			[],
			"a re-entrant pass must not re-apply auto-read over the user's unread",
		);
	});

	it("leaves a manually-unread message alone when syncBodies re-fetches with force", async () => {
		const harness = buildHarness(
			{ messageId: "m-1", bodyStorageKey: "s3://bodies/m-1" },
			async () => {
				throw new Error("force path must not retrieve from storage");
			},
		);

		const result = await harness.service.syncBodies(
			["m-1"],
			"acc-1",
			"cfg-1",
			"INBOX",
			async () => bodyConnection(),
			true,
		);

		assert.deepEqual(result.syncedMessageIds, ["m-1"]);
		assert.deepEqual(
			harness.markReadCalls,
			[],
			"a forced re-sync must not re-apply auto-read over the user's unread",
		);
	});
});
