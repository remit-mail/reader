import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem } from "@remit/data-ports";
import {
	type AdoptLabelFolderDeps,
	type CreateLabelDeps,
	createLabelWithFolders,
	type LabelWithFolders,
	listLabelsWithFolders,
	reconcileRemitFolders,
} from "./label-folders.js";
import { fifoMailboxManagement, MailboxQueueService } from "./mailbox-queue.js";
import { remitRootName } from "./remit-root.js";
import {
	openStore,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
} from "./test-helpers/test-store.js";

let store: Store;
let capture: RecordingQueue;
let account: AccountItem;
let deps: CreateLabelDeps & AdoptLabelFolderDeps;

const ROOT = `INBOX/${remitRootName("abcd")}`;

beforeEach(async () => {
	capture = recordingQueue();
	store = await openStore();
	account = await seedAccount(store);
	await seedMailbox(store, account, "INBOX");
	deps = {
		account: store.account,
		mailbox: store.mailbox,
		label: store.label,
		labelMailbox: store.labelMailbox,
		mailboxQueue: new MailboxQueueService({
			mailboxService: store.mailbox,
			enqueue: fifoMailboxManagement(capture.fifo),
		}),
		log: silentLog,
	};
});

afterEach(async () => {
	await store.close();
});

const createdPaths = (): unknown[] =>
	capture.sent
		.filter((message) => message.body.type === "MAILBOX_CREATE")
		.map((message) => message.body.path);

const created = async (name: string): Promise<LabelWithFolders> => {
	const outcome = await createLabelWithFolders(deps, account.accountConfigId, {
		name,
	});
	assert.ok(outcome.ok, "expected the label to be created");
	return outcome.value;
};

const secondAccount = (): Promise<AccountItem> =>
	store.account.create({
		username: "other@example.com",
		email: "other@example.com",
		authType: account.authType,
		passwordHash: '{"ciphertext":"x"}',
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: account.connectionState,
		accountConfigId: account.accountConfigId,
	});

describe("createLabelWithFolders", () => {
	it("creates the remit root once and one folder per label under it", async () => {
		const receipts = await created("Receipts");
		const [rootPath, receiptsPath] = createdPaths();
		assert.match(String(rootPath), /^INBOX\/[a-z2-7]{5}_remit$/);
		assert.equal(receiptsPath, `${rootPath}/Receipts`);
		assert.deepEqual(
			receipts.folders.map((folder) => folder.state),
			["Pending"],
		);

		await created("Travel");
		assert.deepEqual(createdPaths().slice(2), [`${rootPath}/Travel`]);
	});

	it("reuses the label and its folder when called again", async () => {
		const first = await created("Receipts");
		const again = await created("  receipts ");
		assert.equal(again.label.labelId, first.label.labelId);
		assert.deepEqual(again.folders, first.folders);
		assert.equal(createdPaths().length, 2);
		assert.equal(
			(await store.label.listByAccountConfig(account.accountConfigId)).length,
			1,
		);
	});

	it("takes an existing root and adopts a child that already has the name", async () => {
		await seedMailbox(store, account, ROOT);
		const existing = await seedMailbox(store, account, `${ROOT}/RECEIPTS`);
		const receipts = await created("Receipts");
		assert.deepEqual(createdPaths(), []);
		assert.deepEqual(receipts.folders, [
			{
				accountId: account.accountId,
				state: "Present",
				mailboxId: existing.mailboxId,
				fullPath: existing.fullPath,
			},
		]);
	});

	it("gives the label a folder in every account of the user", async () => {
		const other = await secondAccount();
		await seedMailbox(store, other, "INBOX");
		const receipts = await created("Receipts");
		assert.deepEqual(
			receipts.folders.map((folder) => folder.accountId).sort(),
			[account.accountId, other.accountId].sort(),
		);
		assert.equal(createdPaths().length, 4);
	});

	it("reports an account with no inbox yet as missing", async () => {
		const other = await secondAccount();
		const receipts = await created("Receipts");
		assert.deepEqual(
			receipts.folders.find((folder) => folder.accountId === other.accountId),
			{ accountId: other.accountId, state: "Missing" },
		);
	});

	it("refuses a name that holds the folder separator", async () => {
		const outcome = await createLabelWithFolders(
			deps,
			account.accountConfigId,
			{ name: "Work/Acme" },
		);
		assert.equal(outcome.ok, false);
		assert.deepEqual(createdPaths(), []);
	});
});

describe("reconcileRemitFolders", () => {
	it("creates a root once while one is pending", async () => {
		await reconcileRemitFolders(
			deps,
			account,
			await store.mailbox.listAllByAccount(account.accountId),
		);
		await reconcileRemitFolders(
			deps,
			account,
			await store.mailbox.listAllByAccount(account.accountId),
		);
		assert.equal(createdPaths().length, 1);
	});

	it("maps root children to labels by folded name, and nothing deeper", async () => {
		await seedMailbox(store, account, ROOT);
		const receiptsFolder = await seedMailbox(
			store,
			account,
			`${ROOT}/receipts`,
		);
		await seedMailbox(store, account, `${ROOT}/receipts/Travel`);
		await seedMailbox(store, account, "INBOX/Travel");
		const receipts = await store.label.create({
			accountConfigId: account.accountConfigId,
			name: "Receipts",
		});
		await store.label.create({
			accountConfigId: account.accountConfigId,
			name: "Travel",
		});

		const adopted = await reconcileRemitFolders(
			deps,
			account,
			await store.mailbox.listAllByAccount(account.accountId),
		);

		assert.deepEqual(
			adopted.map((mapping) => [mapping.labelId, mapping.mailboxId]),
			[[receipts.labelId, receiptsFolder.mailboxId]],
		);
		assert.deepEqual(createdPaths(), []);
		const listed = await listLabelsWithFolders(store, account.accountConfigId);
		assert.deepEqual(
			listed.map(({ label, folders }) => [
				label.name,
				folders.map((folder) => folder.state),
			]),
			[
				["Receipts", ["Present"]],
				["Travel", ["Missing"]],
			],
		);
	});
});
