import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MessageSystemFlag } from "@remit/domain-enums";
import { FlagPushService } from "./flag-push.js";
import { resolveExhaustedFlagPushFailure } from "./flag-push-terminal.js";
import { FlagQueueService, type UpdateFlagsInput } from "./flag-queue.js";
import {
	eml,
	type FakeImapConnection,
	FakeImapServer,
} from "./test-helpers/fake-imap.js";
import {
	openStore,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
	silentLog,
} from "./test-helpers/test-store.js";

let store: Store;
let capture: RecordingQueue;
let account: AccountItem;
let inbox: MailboxItem;
let messageId: string;

beforeEach(async () => {
	capture = recordingQueue();
	store = await openStore();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	messageId = (await seedMessage(store, account, inbox, 1)).message.messageId;
});

afterEach(async () => {
	await store.close();
});

const flags = () =>
	new FlagQueueService({
		messageFlagService: store.messageFlag,
		messageService: store.message,
		threadMessageService: store.threadMessage,
		flagPushService: new FlagPushService({
			markerService: store.flagPush,
			queue: capture.fifo,
		}),
	});

const update = (input: UpdateFlagsInput) =>
	flags().updateFlags(
		account.accountConfigId,
		messageId,
		account.accountId,
		input,
	);

const listing = async () =>
	(
		await store.threadMessage.findAllByMessageId(
			account.accountConfigId,
			messageId,
		)
	)[0];

const owedFlagged = async () =>
	(await store.flagPush.find(messageId, MessageSystemFlag.Flagged))?.operation;

describe("updateFlags keeps the star and its colour in step", () => {
	for (const [input, hasStars, star, owed] of [
		[{ isStarred: true }, true, "yellow", "add"],
		[{ isStarred: true, starColor: "red" }, true, "red", "add"],
		[{ starColor: "blue" }, true, "blue", "add"],
		[{ isStarred: true, starColor: "none" }, true, "none", "add"],
	] as const) {
		it(`${JSON.stringify(input)} stars as ${star} and owes the server \\Flagged`, async () => {
			await update(input);

			const row = await listing();
			assert.equal(row.hasStars, hasStars);
			assert.equal(row.star, star);
			assert.equal(await owedFlagged(), owed);
		});
	}

	for (const input of [{ isStarred: false }, { starColor: "none" }] as const) {
		it(`${JSON.stringify(input)} unstars a starred message`, async () => {
			await update({ isStarred: true });

			await update(input);

			const row = await listing();
			assert.equal(row.hasStars, false);
			assert.equal(row.star, "none");
			assert.equal(await owedFlagged(), "remove");
		});
	}

	it("marks read once and treats a repeat as no change", async () => {
		await update({ isRead: true });
		const first = await store.flagPush.find(messageId, MessageSystemFlag.Seen);

		const result = await update({ isRead: true });

		assert.equal(result.isRead, true);
		assert.equal((await listing()).isRead, true);
		assert.deepEqual(
			await store.flagPush.find(messageId, MessageSystemFlag.Seen),
			first,
		);
	});
});

describe("a flag push that exhausted its retries", () => {
	const resolve = async (
		connect: () => FakeImapConnection,
		afterRead: () => Promise<unknown> = async () => {},
	) => {
		await update({ isRead: true });
		const read = await store.message.get(messageId);
		await afterRead();
		return resolveExhaustedFlagPushFailure(
			{
				messageService: store.message,
				markerService: store.flagPush,
				log: silentLog,
			},
			{
				placement: {
					status: read.status,
					mailboxId: read.mailboxId,
					uid: read.uid,
				},
				accountId: account.accountId,
				accountConfigId: account.accountConfigId,
				messageId,
				flagName: MessageSystemFlag.Seen,
				uid: 1,
				mailboxPath: "INBOX",
				getConnection: async () => connect(),
			},
		);
	};

	it("drops the push and the stale rows of a message the server no longer holds", async () => {
		const imap = new FakeImapServer();
		imap.addFolder("INBOX");

		const { outcome } = await resolve(() => imap.connection());

		assert.equal(outcome, "reconciled");
		assert.equal(
			await store.flagPush.find(messageId, MessageSystemFlag.Seen),
			null,
		);
		await assert.rejects(store.message.get(messageId));
	});

	it("leaves a row the user moved after the push read it", async () => {
		const imap = new FakeImapServer();
		imap.addFolder("INBOX");
		const archive = await seedMailbox(store, account, "Archive");

		const { outcome } = await resolve(
			() => imap.connection(),
			() =>
				store.message.transitionPlacement(
					messageId,
					{ mailboxId: inbox.mailboxId },
					{ mailboxId: archive.mailboxId, uid: 7 },
				),
		);

		assert.equal(outcome, "reconciled");
		const moved = await store.message.get(messageId);
		assert.equal(moved.mailboxId, archive.mailboxId);
		assert.equal(moved.uid, 7);
	});

	it("keeps the push and the rows of a message still there, dropped FETCH row or not", async () => {
		const imap = new FakeImapServer();
		imap.addFolder("INBOX");
		imap.deliver("INBOX", eml({}));
		const connection = imap.connection();
		connection.fetchMessages = async () => [];

		const { outcome } = await resolve(() => connection);

		assert.equal(outcome, "broken");
		assert.ok(await store.flagPush.find(messageId, MessageSystemFlag.Seen));
		assert.ok(await store.message.get(messageId));
	});
});
