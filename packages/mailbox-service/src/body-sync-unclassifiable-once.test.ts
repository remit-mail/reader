/**
 * A body the classifier had nothing to say about is examined once (issue #331).
 *
 * `Message.category` is NOT NULL with an `uncategorized` default, so that value
 * means two things at once: a message the classifier has not reached, and one it
 * reached with nothing to say. Keying "needs classifying" on it made every later
 * sync pass re-read the body from storage and rewrite both rows for the same
 * answer — a read amplification that scales with sync frequency and never
 * converges.
 *
 * `Message.classificationState` is the fact itself, written in the same
 * UpdateItem as the answer. It is persistence-only — no response model carries
 * it — and it is what makes the declined cohort addressable later without a
 * sync pass guessing at it.
 *
 * The sender in these tests carries a `flags.category` override of
 * `uncategorized` — the Reclassify dialog's own value for "no category" — which
 * is how a message ends up stored and `uncategorized` at the same time.
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

interface Harness {
	service: BodySyncService;
	message: MessageItem;
	rows: ThreadMessageItem[];
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
	threadUpdates: UpdateThreadMessageInput[];
	retrieved: string[];
}

const buildHarness = (
	message: Partial<MessageItem> & Pick<MessageItem, "messageId">,
	overrideCategory?: (typeof MessageCategory)[keyof typeof MessageCategory],
): Harness => {
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];
	const threadUpdates: UpdateThreadMessageInput[] = [];
	const retrieved: string[] = [];

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
			threadUpdates.push(input);
			const row = rows.find((r) => r.threadMessageId === threadMessageId);
			if (row) Object.assign(row, input);
		},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		retrieve: async (key: string) => {
			retrieved.push(key);
			return LINKEDIN_EML;
		},
		storeMessageBody: async () => ({ uri: `s3://bodies/${message.messageId}` }),
		storeMessageBodyStream: async () => ({
			uri: `s3://bodies/${message.messageId}`,
		}),
		storeParsedBody: async () => {},
		listBodyParts: async () => [],
	} as unknown as StorageService;

	const addressService = {
		getAddress: async () => {
			if (overrideCategory === undefined) {
				throw new NotFoundError("Address not found");
			}
			return {
				flags: { category: { value: overrideCategory, setAt: 1_000 } },
			} as unknown as AddressItem;
		},
		incrementInboundCount: async () => {},
	} as unknown as IAddressRepository;

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		addressService,
		{ listBodyParts: async () => [] } as unknown as IEnvelopeRepository,
		{ info: () => {}, error: () => {} },
	);

	return {
		service,
		message: messageRow,
		rows,
		messageUpdates,
		threadUpdates,
		retrieved,
	};
};

const imapConnection = () =>
	({
		openBox: async () => {},
		async *fetchMessageBodies(uids: number[]) {
			for (const uid of uids) {
				yield { uid, source: Readable.from([LINKEDIN_EML]) };
			}
		},
	}) as unknown as IImapConnection;

const syncPass = (harness: Harness) =>
	harness.service.syncBodies(["m-1"], "acc-1", "cfg-1", "INBOX", async () =>
		imapConnection(),
	);

describe("a body the classifier declined to categorize is examined once", () => {
	it("does not read or rewrite the stored body on the pass after the one that stored it", async () => {
		const harness = buildHarness(
			{ messageId: "m-1" },
			MessageCategory.uncategorized,
		);

		const first = await syncPass(harness);

		assert.deepEqual(first.syncedMessageIds, ["m-1"]);
		assert.equal(harness.message.category, MessageCategory.uncategorized);
		assert.equal(harness.message.bodyStorageKey, "s3://bodies/m-1");
		assert.equal(harness.messageUpdates.length, 1);
		// The answer and the record that it was given, in one write.
		assert.equal(
			harness.messageUpdates[0].input.classificationState,
			"Examined",
		);

		const second = await syncPass(harness);

		assert.equal(second.skippedCount, 1);
		assert.deepEqual(second.failedMessageIds, []);
		assert.deepEqual(harness.retrieved, []);
		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(harness.threadUpdates.length, 1);
	});

	it("leaves a message that is already stored and examined alone", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				bodyStorageKey: "s3://bodies/m-1",
				category: MessageCategory.uncategorized,
				classificationState: "Examined",
			} as Partial<MessageItem> & Pick<MessageItem, "messageId">,
			MessageCategory.uncategorized,
		);

		const result = await syncPass(harness);

		assert.equal(result.skippedCount, 1);
		assert.deepEqual(harness.retrieved, []);
		assert.deepEqual(harness.messageUpdates, []);
		assert.deepEqual(harness.threadUpdates, []);
	});

	it("leaves mail stored before the classifier ran marked as never examined", async () => {
		const harness = buildHarness(
			{
				messageId: "m-1",
				bodyStorageKey: "s3://bodies/m-1",
				category: MessageCategory.uncategorized,
				classificationState: "NotExamined",
			} as Partial<MessageItem> & Pick<MessageItem, "messageId">,
			MessageCategory.uncategorized,
		);

		const result = await syncPass(harness);

		// A sync pass does not re-derive this cohort — that is the amplification
		// #331 removes. It leaves the row saying so, which is what lets a
		// deliberate backfill select it later.
		assert.equal(result.skippedCount, 1);
		assert.deepEqual(harness.retrieved, []);
		assert.deepEqual(harness.messageUpdates, []);
		assert.equal(harness.message.classificationState, "NotExamined");
	});

	it("still fetches and classifies a message whose body has never been stored", async () => {
		const harness = buildHarness({ messageId: "m-1" });

		const result = await syncPass(harness);

		assert.deepEqual(result.syncedMessageIds, ["m-1"]);
		assert.equal(harness.messageUpdates.length, 1);
		assert.equal(
			harness.messageUpdates[0].input.category,
			MessageCategory.social,
		);
		assert.equal(harness.rows[0].category, MessageCategory.social);
	});
});
