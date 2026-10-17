import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type {
	AccountItem,
	MailboxItem,
	UpdateMessageInput,
} from "@remit/data-ports";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	DisplayNameCorrespondence,
	MessageCategory,
	MessageClassificationState,
} from "@remit/domain-enums";
import type { StorageService } from "@remit/storage-service";
import {
	backfillClassifications,
	type ClassificationBackfillCheckpoint,
} from "./classification-backfill.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	arriveAt,
	openStore,
	type Store,
	scratchStorage,
	seedAccount,
	seedMailbox,
	storeBody,
} from "./test-helpers/store.js";

const PLAIN = eml({ From: "Alice <alice@example.com>", Subject: "Hi" }, "hi");

const LIST = eml(
	{
		From: "Alice <alice@example.com>",
		Subject: "Newsletter",
		"List-Id": "<news.example.com>",
		"List-Unsubscribe": "<https://example.com/unsub>",
	},
	"this week in news",
);

const IMPERSONATION = eml(
	{
		From: "InfoMedics <billing@serviceupdatebank.atlassian.net>",
		Subject: "Openstaande factuur",
		"DKIM-Signature": "v=1; a=rsa-sha256; d=atlassian.net; s=sel; b=xxx",
	},
	"Betaal uw factuur",
);

let store: Store;
let storage: StorageService;
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;
let junk: MailboxItem;

beforeEach(async () => {
	store = openStore();
	storage = scratchStorage();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	junk = await seedMailbox(store, account, "Junk", { specialUse: "Junk" });
});

afterEach(() => store.close());

const stored = async (
	raw: Buffer,
	mailbox: MailboxItem = inbox,
	update: UpdateMessageInput = {},
	owner: AccountItem = account,
): Promise<string> => {
	const messageId = await arriveAt(store, imap, owner, mailbox, raw);
	await storeBody(store, storage, owner, messageId, raw);
	await store.message.update(messageId, update);
	return messageId;
};

const deps = () => ({
	accountConfigService: store.accountConfig,
	accountService: store.account,
	mailboxSpecialUseService: store.specialUse,
	addressService: store.address,
	threadMessageService: store.threadMessage,
	messageService: store.message,
	storageService: storage,
});

const threadRow = async (messageId: string) =>
	(
		await store.threadMessage.findAllByMessageId(
			account.accountConfigId,
			messageId,
		)
	)[0];

describe("backfillClassifications", () => {
	it("classifies a never-examined body and denormalizes the answer", async () => {
		const messageId = await stored(LIST);

		const result = await backfillClassifications(deps());

		assert.equal(result.backfilled, 1);
		const row = await store.message.get(messageId);
		assert.equal(row.category, MessageCategory.newsletter);
		assert.equal(row.hasListUnsubscribe, true);
		assert.equal(row.classificationState, MessageClassificationState.Examined);
		const thread = await threadRow(messageId);
		assert.equal(thread.category, MessageCategory.newsletter);
		assert.equal(thread.listId, "news.example.com");
	});

	it("compares the sender of a Junk row the provider rated clean, not of an inbox row", async () => {
		const inJunk = await stored(IMPERSONATION, junk);
		const inInbox = await stored(IMPERSONATION);

		await backfillClassifications(deps());

		assert.equal(
			(await store.message.get(inJunk)).authenticity?.displayNameCorrespondence,
			DisplayNameCorrespondence.Unrelated,
		);
		assert.equal(
			(await store.message.get(inInbox)).authenticity
				?.displayNameCorrespondence,
			undefined,
		);
	});

	it("applies the sender's category override over the headers", async () => {
		const messageId = await stored(PLAIN);
		await store.address.updateAddress(
			account.accountConfigId,
			deriveAddressId(account.accountConfigId, "alice@example.com"),
			{ flags: { category: { value: MessageCategory.marketing, setAt: 1 } } },
		);

		await backfillClassifications(deps());

		assert.equal(
			(await store.message.get(messageId)).category,
			MessageCategory.marketing,
		);
	});

	it("marks an already-categorized row examined and keeps its category", async () => {
		const messageId = await stored(PLAIN, inbox, {
			category: MessageCategory.newsletter,
		});

		const result = await backfillClassifications(deps());

		assert.equal(result.alreadyCategorized, 1);
		const row = await store.message.get(messageId);
		assert.equal(row.category, MessageCategory.newsletter);
		assert.equal(row.classificationState, MessageClassificationState.Examined);
	});

	it("leaves examined rows and rows with no stored body alone", async () => {
		await stored(PLAIN, inbox, {
			classificationState: MessageClassificationState.Examined,
		});
		const unsynced = await arriveAt(store, imap, account, inbox, PLAIN);

		const result = await backfillClassifications(deps());

		assert.equal(result.alreadyExamined, 1);
		assert.equal(result.skippedNoBody, 1);
		assert.equal(
			(await store.message.get(unsynced)).classificationState,
			MessageClassificationState.NotExamined,
		);
	});

	it("examines a message once however many thread rows index it", async () => {
		const messageId = await stored(PLAIN);
		await store.threadMessage.create({
			...(await threadRow(messageId)),
			threadId: "drifted-root",
		});

		const result = await backfillClassifications(deps());

		assert.equal(result.backfilled, 1);
		assert.equal(result.alreadyExamined, 1);
	});

	it("contains a failure to the one message and keeps going", async () => {
		const lost = await stored(PLAIN, inbox, {
			bodyStorageKey: "file:///nonexistent/remit/body.eml",
		});
		const fine = await stored(PLAIN);

		const result = await backfillClassifications(deps());

		assert.equal(result.failed, 1);
		assert.deepEqual(result.failedThreadMessageIds, [
			(await threadRow(lost)).threadMessageId,
		]);
		assert.equal(
			(await store.message.get(fine)).classificationState,
			MessageClassificationState.Examined,
		);
	});

	it("scans accounts in account-config order whatever order they were created in", async () => {
		const second = await seedAccount(store, { accountConfigId: "cfg-a" });
		const third = await seedAccount(store, { accountConfigId: "cfg-b" });
		for (const owner of [third, second]) {
			await stored(
				PLAIN,
				await seedMailbox(store, owner, `INBOX-${owner.accountConfigId}`),
				{},
				owner,
			);
		}
		const order: string[] = [];

		await backfillClassifications(deps(), {
			onProgress: (progress) => order.push(progress.accountConfigId),
		});

		assert.deepEqual(
			order.filter((id) => id !== account.accountConfigId),
			["cfg-a", "cfg-b"],
		);
	});

	it("resumes from its checkpoint after an interruption", async () => {
		for (let i = 0; i < 3; i++) await stored(PLAIN);
		let checkpoint: ClassificationBackfillCheckpoint | undefined;
		let cleared = false;
		const checkpointStore = {
			load: async () => checkpoint,
			save: async (next: ClassificationBackfillCheckpoint) => {
				checkpoint = next;
			},
			clear: async () => {
				checkpoint = undefined;
				cleared = true;
			},
		};

		await assert.rejects(
			backfillClassifications(deps(), {
				batchSize: 2,
				checkpointStore,
				onProgress: () => {
					throw new Error("killed");
				},
			}),
		);
		const resumed = await backfillClassifications(deps(), {
			batchSize: 2,
			checkpointStore,
		});

		assert.equal(resumed.scanned, 1);
		assert.equal(resumed.backfilled, 1);
		assert.equal(cleared, true);
	});

	it("restarts the pass when the checkpointed account no longer exists", async () => {
		for (let i = 0; i < 3; i++) await stored(PLAIN);

		const result = await backfillClassifications(deps(), {
			batchSize: 2,
			checkpointStore: {
				load: async () => ({
					accountConfigId: "cfg-removed",
					continuationToken: "2",
				}),
				save: async () => {},
				clear: async () => {},
			},
		});

		assert.equal(result.scanned, 3);
		assert.equal(result.backfilled, 3);
	});
});
