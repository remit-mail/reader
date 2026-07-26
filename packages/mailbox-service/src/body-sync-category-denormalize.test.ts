/**
 * `thread_message.category` is the copy the list read path is about to filter
 * on, and its write-path defects only appear under conditions a happy-path test
 * never creates (issue #320).
 *
 * 1. The retro classification path wrote the Message before the ThreadMessage
 *    while its skip guard keyed off `message.category`. A failure between the
 *    two left the guard satisfied and the denormalized row stranded at
 *    `uncategorized` forever, because the requeued retry returned early.
 * 2. `denormalizeCategory` resolved one arbitrary row per message. A message
 *    that lives in two mailboxes has two rows, and the second kept
 *    `uncategorized`.
 *
 * Both need fixtures a single row and a single successful pass cannot express:
 * an interrupted write, and a message with two rows.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MessageItem,
	ThreadMessageItem,
	UpdateMessageInput,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import { MessageCategory } from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import type { IImapConnection } from "./types.js";

const LINKEDIN_EML = Buffer.from(
	[
		"From: LinkedIn <messages-noreply@linkedin.com>",
		"To: me@example.com",
		"Subject: You have a new invitation",
		"List-Id: LinkedIn Invitations <invitations.linkedin.com>",
		"List-Unsubscribe: <https://www.linkedin.com/e/unsub>",
		"Content-Type: text/plain",
		"",
		"invitation body text",
	].join("\r\n"),
);

type Row = Pick<
	ThreadMessageItem,
	| "threadMessageId"
	| "messageId"
	| "accountConfigId"
	| "mailboxId"
	| "sentDate"
	| "isRead"
	| "isDeleted"
	| "hasStars"
	| "hasAttachment"
	| "category"
> &
	Partial<Pick<ThreadMessageItem, "snippet" | "listId">>;

interface ThreadUpdate {
	threadMessageId: string;
	input: UpdateThreadMessageInput;
	composites: Record<string, unknown> | undefined;
}

interface Harness {
	service: BodySyncService;
	message: MessageItem;
	rows: Row[];
	messageUpdates: Array<{ messageId: string; input: UpdateMessageInput }>;
	threadUpdates: ThreadUpdate[];
	writeOrder: string[];
}

const buildRow = (
	overrides: Partial<Row> & Pick<Row, "threadMessageId">,
): Row =>
	({
		messageId: "m-1",
		accountConfigId: "cfg-1",
		mailboxId: "mb-inbox",
		sentDate: 1,
		isRead: false,
		isDeleted: false,
		hasStars: false,
		hasAttachment: false,
		category: MessageCategory.uncategorized,
		...overrides,
	}) as Row;

/**
 * The Message and ThreadMessage fixtures are mutated by their writes, so the
 * skip guard sees the state a requeued delivery would. A harness that only
 * records the write cannot show a stranded row: the strand is the guard reading
 * a value that outlived a failed pass.
 */
const buildHarness = (
	rows: Row[],
	options: {
		failThreadUpdates?: number;
		bodyStored?: boolean;
	} = {},
): Harness => {
	const messageUpdates: Array<{
		messageId: string;
		input: UpdateMessageInput;
	}> = [];
	const threadUpdates: ThreadUpdate[] = [];
	const writeOrder: string[] = [];
	let threadUpdateAttempts = 0;

	const message = {
		messageId: "m-1",
		mailboxId: "mb-inbox",
		uid: 1,
		category: MessageCategory.uncategorized,
		...(options.bodyStored === false
			? {}
			: { bodyStorageKey: "s3://bodies/m-1" }),
	} as unknown as MessageItem;

	const messageService = {
		get: async () => message,
		update: async (messageId: string, input: UpdateMessageInput) => {
			writeOrder.push("message");
			messageUpdates.push({ messageId, input });
			Object.assign(message, input);
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findAllByMessageId: async () => rows,
		getByMessageId: async () => rows[0],
		update: async (
			_accountConfigId: string,
			threadMessageId: string,
			input: UpdateThreadMessageInput,
			updateOptions?: { composites?: Record<string, unknown> },
		) => {
			threadUpdateAttempts++;
			if (threadUpdateAttempts <= (options.failThreadUpdates ?? 0)) {
				throw new Error("thread_message write failed");
			}
			writeOrder.push("thread");
			threadUpdates.push({
				threadMessageId,
				input,
				composites: updateOptions?.composites,
			});
			const row = rows.find((r) => r.threadMessageId === threadMessageId);
			if (row) Object.assign(row, input);
		},
	} as unknown as IThreadMessageRepository;

	const storageService = {
		retrieve: async () => LINKEDIN_EML,
		storeMessageBody: async () => ({ uri: "s3://bodies/m-1" }),
		storeParsedBody: async () => {},
		listBodyParts: async () => [],
	} as unknown as StorageService;

	const service = new BodySyncService(
		messageService,
		storageService,
		threadMessageService,
		{ incrementInboundCount: async () => {} } as unknown as IAddressRepository,
		{ listBodyParts: async () => [] } as unknown as IEnvelopeRepository,
		{ info: () => {}, error: () => {} },
	);

	return {
		service,
		message,
		rows,
		messageUpdates,
		threadUpdates,
		writeOrder,
	};
};

const backfill = (harness: Harness) =>
	harness.service.syncBodies(["m-1"], "acc-1", "cfg-1", "INBOX", async () => {
		throw new Error("the backfill must not open IMAP");
	});

const syncFromImap = (harness: Harness) =>
	harness.service.fetchAndGetBody(
		"m-1",
		"acc-1",
		"cfg-1",
		"INBOX",
		async () =>
			({
				openBox: async () => {},
				fetchMessageBody: async () => LINKEDIN_EML,
			}) as unknown as IImapConnection,
	);

describe("the classification backfill survives an interrupted write", () => {
	it("leaves the Message unclassified when the ThreadMessage write fails, so the retry runs again", async () => {
		const harness = buildHarness([buildRow({ threadMessageId: "tm-1" })], {
			failThreadUpdates: 1,
		});

		const failed = await backfill(harness);

		assert.deepEqual(failed.failedMessageIds, ["m-1"]);
		assert.equal(harness.message.category, MessageCategory.uncategorized);
		assert.deepEqual(harness.messageUpdates, []);

		const retried = await backfill(harness);

		assert.deepEqual(retried.failedMessageIds, []);
		assert.equal(harness.message.category, MessageCategory.social);
		assert.equal(harness.rows[0].category, MessageCategory.social);
	});

	it("writes the Message only after the denormalized row is durable", async () => {
		const harness = buildHarness([buildRow({ threadMessageId: "tm-1" })]);

		await backfill(harness);

		assert.deepEqual(harness.writeOrder, ["thread", "message"]);
	});
});

describe("denormalization reaches every row a message has", () => {
	it("carries the backfilled category onto all of a message's rows", async () => {
		const harness = buildHarness([
			buildRow({ threadMessageId: "tm-inbox", mailboxId: "mb-inbox" }),
			buildRow({
				threadMessageId: "tm-archive",
				mailboxId: "mb-archive",
				isRead: true,
			}),
		]);

		await backfill(harness);

		assert.deepEqual(
			harness.rows.map((r) => r.category),
			[MessageCategory.social, MessageCategory.social],
		);
	});

	it("builds the composite block from each row rather than reusing the first", async () => {
		const harness = buildHarness([
			buildRow({ threadMessageId: "tm-inbox", mailboxId: "mb-inbox" }),
			buildRow({
				threadMessageId: "tm-archive",
				mailboxId: "mb-archive",
				isRead: true,
			}),
		]);

		await backfill(harness);

		assert.deepEqual(
			harness.threadUpdates.map((u) => ({
				threadMessageId: u.threadMessageId,
				mailboxId: u.composites?.mailboxId,
				isRead: u.composites?.isRead,
			})),
			[
				{ threadMessageId: "tm-inbox", mailboxId: "mb-inbox", isRead: false },
				{
					threadMessageId: "tm-archive",
					mailboxId: "mb-archive",
					isRead: true,
				},
			],
		);
	});

	it("fans the snippet and the list id out to every row on the sync path", async () => {
		// A snippet and a List-Id are properties of the message, not of the
		// mailbox it happens to sit in, so both rows carry them.
		const harness = buildHarness(
			[
				buildRow({ threadMessageId: "tm-inbox", mailboxId: "mb-inbox" }),
				buildRow({ threadMessageId: "tm-archive", mailboxId: "mb-archive" }),
			],
			{ bodyStored: false },
		);

		await syncFromImap(harness);

		for (const row of harness.rows) {
			assert.equal(row.category, MessageCategory.social);
			assert.equal(row.listId, "invitations.linkedin.com");
			assert.ok(row.snippet?.includes("invitation body text"));
		}
	});

	it("writes nothing for a row that already carries every value", async () => {
		const harness = buildHarness([
			buildRow({
				threadMessageId: "tm-inbox",
				mailboxId: "mb-inbox",
				category: MessageCategory.social,
			}),
			buildRow({ threadMessageId: "tm-archive", mailboxId: "mb-archive" }),
		]);

		await backfill(harness);

		assert.deepEqual(
			harness.threadUpdates.map((u) => u.threadMessageId),
			["tm-archive"],
		);
	});
});
