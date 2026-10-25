import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { MessagePlacementUnsettledError } from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import { AddressRole, MessageKeywordFlag } from "@remit/domain-enums";
import { FlagPushService } from "./flag-push.js";
import { MessageMoveService } from "./message-move.js";
import {
	MoveNotSettledError,
	NoJunkMailboxError,
	SpamReportService,
} from "./spam-report.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	arriveAt,
	openStore,
	type RecordedMessage,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
} from "./test-helpers/test-store.js";

const SENDER = "sender@example.com";

let store: Store;
let capture: RecordingQueue;
let queue: RecordedMessage[];
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;
let junk: MailboxItem | undefined;
let other: MailboxItem;

beforeEach(async () => {
	capture = recordingQueue();
	queue = capture.sent;
	store = await openStore();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	other = await seedMailbox(store, account, "Other");
	junk = await seedMailbox(store, account, "Junk", { specialUse: "Junk" });
	for (const mailbox of await store.mailbox.listAllByAccount(
		account.accountId,
	)) {
		imap.addFolder(mailbox.fullPath);
	}
});

afterEach(async () => {
	await store.close();
});

const userMoves = () =>
	new MessageMoveService({
		messageService: store.message,
		mailboxService: store.mailbox,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		threadMessageService: store.threadMessage,
		addressService: store.address,
		queue: capture.fifo,
	});

const spam = () =>
	new SpamReportService({
		messageService: store.message,
		addressService: store.address,
		accountService: store.account,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		messageMoveService: new MessageMoveService({
			messageService: store.message,
			mailboxService: store.mailbox,
			mailboxSpecialUseService: store.mailboxSpecialUse,
			threadMessageService: store.threadMessage,
			addressService: store.address,
			queue: capture.fifo,
			moveSettleTimeoutMs: 30,
			moveSettlePollMs: 5,
		}),
		flagPushService: new FlagPushService({
			markerService: store.flagPush,
			queue: capture.fifo,
		}),
		moveSettleTimeoutMs: 30,
		moveSettlePollMs: 5,
	});

const arrive = (mailbox: MailboxItem = inbox, from = `Sender <${SENDER}>`) =>
	arriveAt(store, imap, account, mailbox, eml({ From: from }));

const params = (messageId: string) => ({
	accountConfigId: account.accountConfigId,
	accountId: account.accountId,
	messageId,
	setBy: "user-1",
});

const report = (messageId: string) => spam().reportSpam(params(messageId));

const undo = (messageId: string) => spam().notSpam(params(messageId));

const sender = (email = SENDER) =>
	store.address.getAddress(
		account.accountConfigId,
		deriveAddressId(account.accountConfigId, email),
	);

const settle = async (messageId: string) => {
	const row = await store.message.get(messageId);
	await store.message.updateUid(messageId, row.uid + 100, row.mailboxId);
};

const moves = () => queue.filter((event) => event.body.type === "MESSAGE_MOVE");

const row = (messageId: string) => store.message.get(messageId);

describe("SpamReportService.reportSpam", () => {
	it("blocks the sender, moves the message to Junk and owes the server $Junk", async () => {
		const messageId = await arrive();

		await report(messageId);

		const blocked = (await sender()).flags.blocked;
		assert.equal(blocked?.value, true);
		assert.equal(blocked?.setBy, "user-1");
		const moved = await row(messageId);
		assert.equal(moved.mailboxId, junk?.mailboxId);
		assert.ok((moved.spamReport?.reportedAt ?? 0) > 0);
		assert.equal(moves().length, 1);
		assert.equal(
			(await store.flagPush.find(messageId, MessageKeywordFlag.Junk))
				?.operation,
			"add",
		);
	});

	it("keeps the block when the move fails", async () => {
		const messageId = await arrive();
		capture.answer(async () => {
			throw new Error("SQS unavailable");
		});

		await assert.rejects(report(messageId), /SQS unavailable/);

		assert.equal((await sender()).flags.blocked?.value, true);
	});

	it("moves once under a double press, and refuses a press inside the first move's flight", async () => {
		const messageId = await arrive();
		await report(messageId);

		await assert.rejects(
			report(messageId),
			(error: unknown) =>
				error instanceof MessagePlacementUnsettledError &&
				error.publicApiError?.details?.reason === "in_flight",
		);
		await settle(messageId);
		await report(messageId);

		assert.equal(moves().length, 1);
	});

	it("moves mail forged from the account's own address without blocking the account", async () => {
		const messageId = await arrive(inbox, `Me <${account.email}>`);

		await report(messageId);

		assert.equal((await sender(account.email)).flags.blocked, undefined);
		assert.equal((await row(messageId)).mailboxId, junk?.mailboxId);
	});

	it("blocks a sender that was never harvested into the address book", async () => {
		const messageId = await arrive();
		await store.address.deleteAddress(
			account.accountConfigId,
			deriveAddressId(account.accountConfigId, SENDER),
		);

		await report(messageId);

		assert.equal((await sender()).flags.blocked?.value, true);
		assert.equal((await row(messageId)).mailboxId, junk?.mailboxId);
	});

	it("refuses to mint an address row for a sender with no @", async () => {
		const { message } = await seedMessage(store, account, inbox, 9);
		await store.address.upsertEnvelopeAddress({
			messageId: message.messageId,
			addressId: deriveAddressId(account.accountConfigId, "no-at-sign"),
			displayName: "",
			normalizedEmail: "no-at-sign",
			addressRole: AddressRole.From,
			addressOrder: 0,
		});

		await assert.rejects(
			report(message.messageId),
			/not a usable email address/,
		);

		assert.deepEqual(
			await store.address.getAddress(account.accountConfigId, [
				deriveAddressId(account.accountConfigId, "no-at-sign"),
			]),
			[],
		);
	});

	it("keeps the junkOnly mark that withholds the sender from autocomplete", async () => {
		const messageId = await arrive(junk);

		await report(messageId);

		const flags = (await sender()).flags;
		assert.equal(flags.blocked?.value, true);
		assert.equal(flags.junkOnly?.value, true);
	});

	it("names the missing Junk folder and changes nothing", async () => {
		await store.mailboxSpecialUse.deleteByMailboxId(junk?.mailboxId as string);
		await store.mailbox.delete(account.accountId, junk?.mailboxId as string);
		junk = undefined;
		const messageId = await arrive();

		await assert.rejects(
			report(messageId),
			(error: unknown) =>
				error instanceof NoJunkMailboxError &&
				/no Junk folder/.test(error.message) &&
				/Create one/.test(error.message),
		);

		assert.equal((await sender()).flags.blocked, undefined);
		const untouched = await row(messageId);
		assert.equal(untouched.mailboxId, inbox.mailboxId);
		assert.equal(untouched.spamReport, undefined);
		assert.equal(queue.length, 0);
	});
});

describe("SpamReportService.notSpam", () => {
	it("restores the original folder and lifts the block without granting trust", async () => {
		const messageId = await arrive();
		await report(messageId);
		await settle(messageId);

		await undo(messageId);

		const restored = await row(messageId);
		assert.equal(restored.mailboxId, inbox.mailboxId);
		assert.equal(restored.spamReport, undefined);
		const flags = (await sender()).flags;
		assert.equal(flags.blocked, undefined);
		assert.equal(flags.wellknown, undefined);
		assert.equal(flags.vip, undefined);
	});

	it("mints no address row for a sender that was never harvested", async () => {
		const messageId = await arrive(junk);
		await store.address.deleteAddress(
			account.accountConfigId,
			deriveAddressId(account.accountConfigId, SENDER),
		);

		await undo(messageId);

		assert.deepEqual(
			await store.address.getAddress(account.accountConfigId, [
				deriveAddressId(account.accountConfigId, SENDER),
			]),
			[],
		);
	});

	it("leaves mail an earlier, unrelated move filed in Junk where it is", async () => {
		const messageId = await arrive(other);
		await userMoves().moveMessage(
			account.accountConfigId,
			messageId,
			junk?.mailboxId as string,
			account.accountId,
		);
		await settle(messageId);
		queue.length = 0;

		await report(messageId);
		await undo(messageId);

		assert.equal((await row(messageId)).mailboxId, junk?.mailboxId);
		assert.equal((await sender()).flags.blocked, undefined);
	});

	it("still restores after a second report, and a second undo moves nothing", async () => {
		const messageId = await arrive();
		await report(messageId);
		await settle(messageId);
		await report(messageId);

		await undo(messageId);
		await undo(messageId);

		const restored = await row(messageId);
		assert.equal(restored.mailboxId, inbox.mailboxId);
		assert.equal(restored.originalMailboxId, undefined);
		assert.equal(moves().length, 2);
	});

	it("refuses to restore before the move settled, but still lifts the block", async () => {
		const messageId = await arrive();
		await report(messageId);

		await assert.rejects(undo(messageId), (error: unknown) => {
			assert.ok(error instanceof MoveNotSettledError);
			assert.match(error.message, /has not settled yet/);
			return true;
		});

		assert.equal((await sender()).flags.blocked, undefined);
		const unmoved = await row(messageId);
		assert.equal(unmoved.mailboxId, junk?.mailboxId);
		assert.ok((unmoved.spamReport?.reportedAt ?? 0) > 0);
	});
});
