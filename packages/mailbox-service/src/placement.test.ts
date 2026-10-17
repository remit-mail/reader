import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type {
	AccountItem,
	CreateMessageInput,
	MailboxItem,
} from "@remit/data-ports";
import { MessagePlacementUnsettledError } from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import { MessageMoveService } from "./message-move.js";
import { PlacementMoveService } from "./placement-move.js";
import { resolveExhaustedPlacementMoveFailure } from "./placement-move-terminal.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	arriveAt,
	beforeNext,
	captureQueue,
	openStore,
	type QueueCapture,
	type QueuedEvent,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
	silentLog,
} from "./test-helpers/test-store.js";

let store: Store;
let capture: QueueCapture;
let queue: QueuedEvent[];
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;
let archive: MailboxItem;
let junk: MailboxItem;
let trash: MailboxItem;

beforeEach(async () => {
	capture = captureQueue();
	queue = capture.sent;
	store = await openStore();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	archive = await seedMailbox(store, account, "Archive");
	junk = await seedMailbox(store, account, "Junk", { specialUse: "Junk" });
	trash = await seedMailbox(store, account, "Trash", { specialUse: "Trash" });
	for (const mailbox of await store.mailbox.listAllByAccount(
		account.accountId,
	)) {
		imap.addFolder(mailbox.fullPath);
	}
});

afterEach(async () => {
	capture.restore();
	await store.close();
});

const filing = () =>
	new PlacementMoveService({
		messageService: store.message,
		threadMessageService: store.threadMessage,
		markerService: store.placementMove,
		addressService: store.address,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		sqsQueueUrl: "https://sqs.test/message-mgmt",
		moveSettleTimeoutMs: 200,
		moveSettlePollMs: 10,
	});

const userMoves = () =>
	new MessageMoveService({
		messageService: store.message,
		mailboxService: store.mailbox,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		threadMessageService: store.threadMessage,
		addressService: store.address,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
		moveSettleTimeoutMs: 200,
		moveSettlePollMs: 10,
	});

const rowIn = async (
	mailbox: MailboxItem,
	uid: number,
	message: Partial<CreateMessageInput> = {},
) =>
	(await seedMessage(store, account, mailbox, uid, { message })).message
		.messageId;

const row = (messageId: string) => store.message.get(messageId);

const listing = async (messageId: string) =>
	(
		await store.threadMessage.findAllByMessageId(
			account.accountConfigId,
			messageId,
		)
	)[0];

const file = (messageId: string, destination: MailboxItem) =>
	filing().moveMessage(
		account.accountConfigId,
		messageId,
		destination.mailboxId,
		account.accountId,
	);

const confirmMove = async (messageId: string, uid: number) => {
	const marker = await store.placementMove.find(messageId);
	await store.message.updateUid(
		messageId,
		uid,
		marker?.destinationMailboxId ?? "",
	);
	await store.placementMove.delete(messageId);
};

const settleElsewhere = (messageId: string) => () =>
	store.message.updateUid(messageId, 907, archive.mailboxId);

describe("a classification filing", () => {
	it("moves the row and its listing locally, leaves a queued marker and enqueues the push", async () => {
		const messageId = await rowIn(inbox, 42);

		await file(messageId, junk);

		const moved = await row(messageId);
		assert.equal(moved.mailboxId, junk.mailboxId);
		assert.equal(moved.status, "moving");
		assert.equal(moved.originalUid, 42);
		assert.equal((await listing(messageId)).mailboxId, junk.mailboxId);
		assert.equal((await store.placementMove.find(messageId))?.state, "queued");
		assert.deepEqual(
			queue.map((event) => event.body.type),
			["PLACEMENT_MOVE_PUSH"],
		);
	});

	it("withholds the sender of a message it files into Junk", async () => {
		const messageId = await arriveAt(
			store,
			imap,
			account,
			inbox,
			eml({ From: "Spam <spam@example.com>" }),
		);

		await file(messageId, junk);

		const sender = await store.address.getAddress(
			account.accountConfigId,
			deriveAddressId(account.accountConfigId, "spam@example.com"),
		);
		assert.equal(sender.flags.junkOnly?.value, true);
	});

	it("does nothing for a message already in the destination", async () => {
		const messageId = await rowIn(junk, 42);

		await file(messageId, junk);

		assert.equal(await store.placementMove.find(messageId), null);
		assert.equal(queue.length, 0);
	});

	it("binds a second filing to the confirmed row once the first move settles", async () => {
		const messageId = await rowIn(inbox, 42);
		await file(messageId, archive);

		setTimeout(() => void confirmMove(messageId, 907), 30);
		await file(messageId, junk);

		const marker = await store.placementMove.find(messageId);
		assert.equal(marker?.sourceMailboxId, archive.mailboxId);
		assert.equal((await row(messageId)).originalUid, 907);
	});

	it("leaves the first move standing when it never settles", async () => {
		const messageId = await rowIn(inbox, 42);
		await file(messageId, archive);

		await assert.rejects(file(messageId, junk), /has not settled/);

		const marker = await store.placementMove.find(messageId);
		assert.equal(marker?.sourceMailboxId, inbox.mailboxId);
		assert.equal(marker?.destinationMailboxId, archive.mailboxId);
	});

	it("drives a marker whose push never went out forward without moving again", async () => {
		const messageId = await rowIn(inbox, 42);
		await file(messageId, archive);
		await store.placementMove.updateState(messageId, "pending");

		await file(messageId, archive);

		assert.equal((await store.placementMove.find(messageId))?.state, "queued");
		assert.equal((await row(messageId)).originalUid, 42);
		assert.equal(queue.length, 2);
	});

	it("skips a message a delete has claimed without waiting", async () => {
		const messageId = await rowIn(archive, 42, {
			status: "deleting",
			syncStatus: "pending",
		});

		const startedAt = Date.now();
		await file(messageId, junk);

		assert.ok(Date.now() - startedAt < 100);
		assert.equal(await store.placementMove.find(messageId), null);
		assert.equal(queue.length, 0);
	});

	it("writes nothing, listing included, when the row settles elsewhere mid-decision", async () => {
		const messageId = await rowIn(inbox, 42);
		beforeNext(store.placementMove, "put", settleElsewhere(messageId));

		await file(messageId, junk);

		const after = await row(messageId);
		assert.equal(after.mailboxId, archive.mailboxId);
		assert.equal(after.uid, 907);
		assert.equal((await listing(messageId)).mailboxId, inbox.mailboxId);
		assert.equal(await store.placementMove.find(messageId), null);
		assert.equal(queue.length, 0);
	});
});

describe("a user mutation writes only against the placement it read", () => {
	it("refuses a move when the row settles elsewhere mid-decision", async () => {
		const messageId = await rowIn(inbox, 42);
		beforeNext(store.mailbox, "get", settleElsewhere(messageId));

		await assert.rejects(
			userMoves().moveMessage(
				account.accountConfigId,
				messageId,
				junk.mailboxId,
				account.accountId,
			),
			MessagePlacementUnsettledError,
		);

		const after = await row(messageId);
		assert.equal(after.mailboxId, archive.mailboxId);
		assert.equal(after.status, "active");
		assert.equal(queue.length, 0);
	});

	for (const source of ["INBOX", "Trash"] as const) {
		it(`reports a delete out of ${source} it could not claim`, async () => {
			const messageId = await rowIn(source === "Trash" ? trash : inbox, 42);
			beforeNext(
				store.mailboxSpecialUse,
				"resolveTrashRole",
				settleElsewhere(messageId),
			);

			const { refusedMessageIds } = await userMoves().deleteMessages(
				account.accountConfigId,
				[messageId],
				account.accountId,
			);

			assert.deepEqual(refusedMessageIds, [messageId]);
			assert.equal((await row(messageId)).mailboxId, archive.mailboxId);
			assert.equal(queue.length, 0);
		});
	}

	it("reports a row whose folder belongs to another account", async () => {
		const other = await seedAccount(store);
		const foreign = await seedMailbox(store, other, "INBOX");
		const messageId = await rowIn(foreign, 42);

		const { refusedMessageIds } = await userMoves().deleteMessages(
			account.accountConfigId,
			[messageId],
			account.accountId,
		);

		assert.deepEqual(refusedMessageIds, [messageId]);
		assert.equal(queue.length, 0);
	});
});

describe("a filing that exhausted its retries", () => {
	const resolve = (messageId: string, uid: number, source: MailboxItem) =>
		resolveExhaustedPlacementMoveFailure(
			{
				messageService: store.message,
				threadMessageService: store.threadMessage,
				markerService: store.placementMove,
				log: silentLog,
			},
			{
				accountId: account.accountId,
				accountConfigId: account.accountConfigId,
				messageId,
				uid,
				sourceMailboxId: source.mailboxId,
				sourceMailboxPath: source.fullPath,
				getConnection: async () => imap.connection(),
			},
		);

	const filedFromInbox = async () => {
		const uid = imap.deliver("INBOX", eml({}));
		const messageId = await rowIn(inbox, uid);
		await file(messageId, junk);
		return { messageId, uid };
	};

	it("removes the row of a message gone from the folder it left", async () => {
		const { messageId, uid } = await filedFromInbox();
		imap.expunge("INBOX", uid);

		const { outcome } = await resolve(messageId, uid, inbox);

		assert.equal(outcome, "reconciled");
		await assert.rejects(row(messageId));
		assert.equal(await store.placementMove.find(messageId), null);
	});

	it("puts a message still in its source back there instead of leaving it moving", async () => {
		const { messageId, uid } = await filedFromInbox();

		const { outcome } = await resolve(messageId, uid, inbox);

		assert.equal(outcome, "broken");
		const restored = await row(messageId);
		assert.equal(restored.mailboxId, inbox.mailboxId);
		assert.equal(restored.uid, uid);
		assert.equal(restored.status, "active");
		assert.equal(restored.abandonedMutation, "none");
		assert.equal((await listing(messageId)).mailboxId, inbox.mailboxId);
		assert.equal(await store.placementMove.find(messageId), null);
	});

	it("does not read a dropped FETCH row as the message being gone", async () => {
		const { messageId, uid } = await filedFromInbox();
		const connection = imap.connection();
		connection.fetchMessages = async () => [];

		const { outcome } = await resolveExhaustedPlacementMoveFailure(
			{
				messageService: store.message,
				threadMessageService: store.threadMessage,
				markerService: store.placementMove,
				log: silentLog,
			},
			{
				accountId: account.accountId,
				accountConfigId: account.accountConfigId,
				messageId,
				uid,
				sourceMailboxId: inbox.mailboxId,
				sourceMailboxPath: "INBOX",
				getConnection: async () => connection,
			},
		);

		assert.equal(outcome, "broken");
		assert.ok(await row(messageId));
	});

	it("leaves a row another lane already settled to that lane", async () => {
		const { messageId, uid } = await filedFromInbox();
		await confirmMove(messageId, 5);

		const { outcome } = await resolve(messageId, uid, inbox);

		assert.equal(outcome, "broken");
		const after = await row(messageId);
		assert.equal(after.mailboxId, junk.mailboxId);
		assert.equal((await listing(messageId)).mailboxId, junk.mailboxId);
	});
});
