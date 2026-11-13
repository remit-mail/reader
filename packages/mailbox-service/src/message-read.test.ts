import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import {
	buildBodyPartKey,
	MATERIALIZED_SENTINEL_PART_PATH,
	type StorageService,
} from "@remit/storage-service";
import { BodySyncService } from "./body-sync.js";
import { resolveBodyReadMiss } from "./message-read.js";
import { SyncWarningService } from "./sync-warning.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	arriveAt,
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
	spamConfigFor,
} from "./test-helpers/test-store.js";

let store: Store;
let storage: StorageService;
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;
let bodySync: BodySyncService;

beforeEach(async () => {
	store = await openStore();
	storage = store.storage();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	imap.addFolder("INBOX");
	bodySync = new BodySyncService(
		store.message,
		storage,
		store.threadMessage,
		store.address,
		store.envelope,
		new SyncWarningService(store.syncWarning),
		spamConfigFor(store),
		silentLog,
	);
});

afterEach(() => store.close());

const syncedBody = async (): Promise<{
	messageId: string;
	partPath: string;
}> => {
	const messageId = await arriveAt(
		store,
		imap,
		account,
		inbox,
		eml({ Subject: "read miss" }),
	);
	await bodySync.syncBodies(
		[messageId],
		account.accountId,
		account.accountConfigId,
		{
			mailboxId: inbox.mailboxId,
			fullPath: inbox.fullPath,
			placement: "inbox",
			uidValidity: inbox.uidValidity,
			createdAt: inbox.createdAt,
		},
		async () => imap.connection(),
		{ force: false, concurrency: 1, bytesInFlight: 1024 * 1024 },
	);
	const { bodyStorageKey } = await store.message.get(messageId);
	assert.ok(bodyStorageKey);
	await bodySync.ensureBodyPartsStored(
		account.accountConfigId,
		account.accountId,
		messageId,
		bodyStorageKey,
	);
	const leaf = (await store.envelope.listBodyParts(messageId)).find(
		(part) => !part.isMultipart,
	);
	assert.ok(leaf);
	return { messageId, partPath: leaf.partPath };
};

const deps = () => ({
	message: store.message,
	mailbox: store.mailbox,
	envelope: store.envelope,
	storage,
});

const miss = (messageId: string, partPath: string) =>
	resolveBodyReadMiss(deps(), {
		accountConfigId: account.accountConfigId,
		accountId: account.accountId,
		messageId,
		partPath,
	});

const partExists = (messageId: string, partPath: string) =>
	storage.bodyPartExists(
		account.accountConfigId,
		account.accountId,
		messageId,
		partPath,
	);

const deletePart = (messageId: string, partPath: string) =>
	storage.deleteKeys([
		buildBodyPartKey(
			account.accountConfigId,
			account.accountId,
			messageId,
			partPath,
		),
	]);

describe("a content read that found no object", () => {
	it("is not found for a message the store does not hold", async () => {
		assert.equal(await miss("no-such-message", "1"), "NotFound");
	});

	it("is not found for a part path that is no leaf of the message", async () => {
		const { messageId } = await syncedBody();
		assert.equal(await miss(messageId, "9.9"), "NotFound");
	});

	it("is not found under an account that does not hold the message", async () => {
		const { messageId, partPath } = await syncedBody();
		const other = await seedAccount(store);
		assert.equal(
			await resolveBodyReadMiss(deps(), {
				accountConfigId: other.accountConfigId,
				accountId: other.accountId,
				messageId,
				partPath,
			}),
			"NotFound",
		);
	});

	it("is broken once the body sync marked the message failed", async () => {
		const { messageId, partPath } = await syncedBody();
		await storage.storeBodyPart({
			accountConfigId: account.accountConfigId,
			accountId: account.accountId,
			messageId,
			partPath: ".sync-failed",
			content: Buffer.from("{}"),
		});
		assert.equal(await miss(messageId, partPath), "Broken");
	});

	it("drops a sentinel whose part went missing, so the next describe restores it", async () => {
		const { messageId, partPath } = await syncedBody();
		await deletePart(messageId, partPath);

		assert.equal(await miss(messageId, partPath), "Pending");
		assert.equal(
			await partExists(messageId, MATERIALIZED_SENTINEL_PART_PATH),
			false,
		);

		const { bodyStorageKey } = await store.message.get(messageId);
		assert.ok(bodyStorageKey);
		await bodySync.ensureBodyPartsStored(
			account.accountConfigId,
			account.accountId,
			messageId,
			bodyStorageKey,
		);
		assert.equal(await partExists(messageId, partPath), true);
	});

	it("is pending for a message whose body has not landed yet", async () => {
		const messageId = await arriveAt(
			store,
			imap,
			account,
			inbox,
			eml({ Subject: "not yet" }),
		);
		const leaf = (await store.envelope.listBodyParts(messageId)).find(
			(part) => !part.isMultipart,
		);
		assert.ok(leaf);
		assert.equal(await miss(messageId, leaf.partPath), "Pending");
	});
});
