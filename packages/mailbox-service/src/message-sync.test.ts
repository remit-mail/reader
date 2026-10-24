import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { deriveAddressId, deriveCopyMessageId } from "@remit/data-ports/id";
import {
	MailboxCursorState,
	MessageKeywordFlag,
	MessageSystemFlag,
} from "@remit/domain-enums";
import { FlagPushService } from "./flag-push.js";
import { FlagQueueService } from "./flag-queue.js";
import { MessageMoveService } from "./message-move.js";
import { MessageSyncService } from "./message-sync.js";
import { QuarantineService } from "./quarantine.js";
import { SyncWarningService } from "./sync-warning.js";
import {
	eml,
	type FakeImapConnection,
	FakeImapServer,
} from "./test-helpers/fake-imap.js";
import {
	captureQueue,
	messageAtUid,
	openStore,
	type QueueCapture,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
} from "./test-helpers/test-store.js";

const SPAMMER = eml({
	From: "Pharma Deals <sales@pharma.example>",
	To: "victim@ischen.nl",
	"Message-ID": "<deal@pharma.example>",
});

let store: Store;
let capture: QueueCapture;
let imap: FakeImapServer;
let connection: FakeImapConnection;
let account: AccountItem;
let inbox: MailboxItem;
let junk: MailboxItem;
let trash: MailboxItem;
let receipts: MailboxItem;
let allMail: MailboxItem;
let logMark: number;

beforeEach(async () => {
	capture = captureQueue();
	store = await openStore();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	junk = await seedMailbox(store, account, "INBOX/Rubbish", {
		specialUse: "Junk",
	});
	trash = await seedMailbox(store, account, "Trash", { specialUse: "Trash" });
	receipts = await seedMailbox(store, account, "Receipts");
	allMail = await seedMailbox(store, account, "[Gmail]/All Mail", {
		specialUse: "All",
	});
	for (const mailbox of [inbox, junk, trash, receipts, allMail]) {
		imap.addFolder(mailbox.fullPath);
	}
	connection = imap.connection();
	logMark = 0;
});

afterEach(async () => {
	capture.restore();
	await store.close();
});

const flagPushService = () =>
	new FlagPushService({
		markerService: store.flagPush,
		sqsQueueUrl: "https://sqs.test/flags",
	});

const syncService = () =>
	new MessageSyncService(
		{ getConnection: () => connection, close: async () => {} },
		store.mailbox,
		store.mailboxSpecialUse,
		store.message,
		store.envelope,
		store.address,
		store.threadMessage,
		new SyncWarningService(store.syncWarning),
		silentLog,
		store.flagPush,
		store.messageFlag,
		new QuarantineService(
			store.quarantine,
			store.mailboxSpecialUse,
			"sha-test",
			silentLog,
		),
	);

const userMoves = () =>
	new MessageMoveService({
		messageService: store.message,
		mailboxService: store.mailbox,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		threadMessageService: store.threadMessage,
		addressService: store.address,
		sqsQueueUrl: "http://localhost:9324/000000000000/remit-messages.fifo",
	});

const flagQueue = () =>
	new FlagQueueService({
		messageFlagService: store.messageFlag,
		messageService: store.message,
		threadMessageService: store.threadMessage,
		flagPushService: flagPushService(),
	});

const sync = (mailbox: MailboxItem, batchSize = 50) =>
	syncService().syncMessages(
		mailbox.mailboxId,
		account.accountId,
		account.accountConfigId,
		batchSize,
	);

const settle = async (mailbox: MailboxItem) => {
	for (;;) {
		const result = await sync(mailbox);
		if (!result.hasMore && result.syncedCount === 0) return;
	}
};

const stored = (mailbox: MailboxItem) =>
	store.mailbox.get(account.accountId, mailbox.mailboxId);

const threadOf = async (messageId: string) =>
	(
		await store.threadMessage.findAllByMessageId(
			account.accountConfigId,
			messageId,
		)
	)[0];

const address = (email: string) =>
	store.address.getAddress(
		account.accountConfigId,
		deriveAddressId(account.accountConfigId, email),
	);

const sent = (verb: "SEARCH" | "FETCH", marker = "") =>
	imap.log
		.slice(logMark)
		.filter((line) => line.startsWith(`${verb} `) && line.includes(marker))
		.length;

const serverMove = async (from: MailboxItem, uid: number, to: MailboxItem) => {
	const otherClient = imap.connection();
	await otherClient.openBox(from.fullPath);
	const { uidMap } = await otherClient.moveMessages([uid], to.fullPath);
	const moved = uidMap.get(uid);
	if (moved === undefined) throw new Error(`no uid ${uid} in ${from.fullPath}`);
	return moved;
};

const arrive = async (mailbox: MailboxItem, raw: Buffer = SPAMMER) => {
	const uid = imap.deliver(mailbox.fullPath, raw);
	await sync(mailbox);
	return { uid, message: await messageAtUid(store, mailbox, uid) };
};

describe("harvesting envelope display names", () => {
	const spoofed = eml({
		From: '"matthijs@ischen.nl" <aramirez@secresaludguaviare.gov.co>',
	});

	it("drops a name that is an address the sender does not own, wherever it lands", async () => {
		const { message } = await arrive(inbox, spoofed);

		const sender = await address("aramirez@secresaludguaviare.gov.co");
		assert.equal(sender.displayName ?? "", "");
		assert.equal(
			sender.normalizedCompound,
			"aramirez@secresaludguaviare.gov.co",
		);
		const data = await store.envelope.getMessageData(message.messageId);
		assert.ok(data.envelopeAddress.length > 0);
		for (const entry of data.envelopeAddress) {
			if (entry.normalizedEmail !== "aramirez@secresaludguaviare.gov.co")
				continue;
			assert.equal(entry.displayName ?? "", "");
		}
		const thread = await threadOf(message.messageId);
		assert.equal(thread.fromName, undefined);
		assert.equal(thread.fromEmail, "aramirez@secresaludguaviare.gov.co");
	});

	it("keeps what a name says besides the address it claims", async () => {
		const { message } = await arrive(
			inbox,
			eml({ From: '"Support <matthijs@ischen.nl>" <aramirez@example.gov>' }),
		);

		assert.equal((await threadOf(message.messageId)).fromName, "Support");
		assert.equal(
			(await address("aramirez@example.gov")).displayName,
			"Support",
		);
	});

	it("harvests every envelope role", async () => {
		await arrive(
			inbox,
			eml({
				From: "Someone <from@example.com>",
				To: "Someone <to@example.com>",
				Cc: "Someone <cc@example.com>",
				"Reply-To": "Someone <reply-to@example.com>",
			}),
		);

		for (const email of [
			"from@example.com",
			"to@example.com",
			"cc@example.com",
			"reply-to@example.com",
		]) {
			assert.equal((await address(email)).displayName, "Someone");
		}
	});
});

describe("what a folder says about the senders on its mail", () => {
	it("harvests the senders of ordinary mail as correspondents", async () => {
		await arrive(inbox);

		assert.equal(
			(await address("sales@pharma.example")).flags.junkOnly,
			undefined,
		);
	});

	it("withholds the senders of mail in the appointed Junk folder", async () => {
		const { message } = await arrive(junk);

		assert.equal(
			(await address("sales@pharma.example")).flags.junkOnly?.value,
			true,
		);
		const data = await store.envelope.getMessageData(message.messageId);
		assert.ok(
			data.envelopeAddress.some(
				(entry) => entry.normalizedEmail === "sales@pharma.example",
			),
		);
	});

	it("keeps mail in Trash from deciding either way", async () => {
		await arrive(trash);

		assert.equal(
			(await address("sales@pharma.example")).flags.junkOnly,
			undefined,
		);
	});
});

describe("a message the database already holds, sighted in another folder", () => {
	it("follows another client's move into Junk, with the new folder's UID", async () => {
		const { uid, message } = await arrive(inbox);
		const moved = await serverMove(inbox, uid, junk);

		const result = await sync(junk);

		const row = await store.message.get(message.messageId);
		assert.equal(row.mailboxId, junk.mailboxId);
		assert.equal(row.uid, moved);
		const thread = await threadOf(message.messageId);
		assert.equal(thread.mailboxId, junk.mailboxId);
		assert.equal(thread.uid, moved);
		assert.deepEqual(result.syncedMessageIds, [message.messageId]);
		assert.equal(
			(await address("sales@pharma.example")).flags.junkOnly?.value,
			true,
		);
	});

	it("follows the rescue back out of Junk and restores the sender", async () => {
		const { uid, message } = await arrive(junk);
		await serverMove(junk, uid, inbox);

		await sync(inbox);

		assert.equal(
			(await store.message.get(message.messageId)).mailboxId,
			inbox.mailboxId,
		);
		assert.equal(
			(await address("sales@pharma.example")).flags.junkOnly,
			undefined,
		);
	});

	it("marks the listing row deleted in Trash and clears it on the way out", async () => {
		imap.condstore = false;
		const { uid, message } = await arrive(inbox);
		const inTrash = await serverMove(inbox, uid, trash);
		await sync(trash);
		assert.equal((await threadOf(message.messageId)).isDeleted, true);

		await serverMove(trash, inTrash, inbox);
		await sync(inbox);

		assert.equal((await threadOf(message.messageId)).isDeleted, false);
	});

	it("leaves a labelled message in the folder that still holds it", async () => {
		const { message } = await arrive(inbox);
		imap.deliver("Receipts", SPAMMER);

		const result = await sync(receipts);

		assert.equal(
			(await store.message.get(message.messageId)).mailboxId,
			inbox.mailboxId,
		);
		assert.equal(
			(await threadOf(message.messageId)).mailboxId,
			inbox.mailboxId,
		);
		assert.equal(result.cursorStalled, false);
		assert.equal((await stored(receipts)).highWaterMarkUid, 1);
	});

	it("holds the watermark when the folder it came from cannot be asked", async () => {
		const { uid, message } = await arrive(inbox);
		await serverMove(inbox, uid, junk);
		imap.removeFolder("INBOX");

		await sync(junk);

		assert.equal(
			(await store.message.get(message.messageId)).mailboxId,
			inbox.mailboxId,
		);
		assert.equal((await stored(junk)).highWaterMarkUid, 0);
	});

	it("declines a sighting in a folder that copies every message", async () => {
		const { message } = await arrive(inbox);
		imap.deliver("[Gmail]/All Mail", SPAMMER);

		await sync(allMail);

		assert.equal(
			(await store.message.get(message.messageId)).mailboxId,
			inbox.mailboxId,
		);
	});

	it("declines a sighting of a copy the user put in that folder", async () => {
		const { message } = await arrive(inbox);
		await userMoves().copyMessage(
			account.accountConfigId,
			message.messageId,
			junk.mailboxId,
			account.accountId,
		);
		const copied = imap.deliver("INBOX/Rubbish", SPAMMER);
		await store.message.updateUid(
			deriveCopyMessageId(message.messageId, junk.mailboxId),
			copied,
			junk.mailboxId,
		);

		await sync(junk);

		assert.equal(
			(await store.message.get(message.messageId)).mailboxId,
			inbox.mailboxId,
		);
	});

	it("follows another client's move into a folder already on CHANGEDSINCE", async () => {
		const { uid, message } = await arrive(inbox);
		await settle(junk);
		await serverMove(inbox, uid, junk);

		await sync(junk);

		assert.equal(
			(await store.message.get(message.messageId)).mailboxId,
			junk.mailboxId,
		);
	});

	it("holds a row whose own move has not settled", async () => {
		const { uid, message } = await arrive(inbox);
		await userMoves().moveMessage(
			account.accountConfigId,
			message.messageId,
			receipts.mailboxId,
			account.accountId,
		);
		await serverMove(inbox, uid, junk);

		await sync(junk);

		const row = await store.message.get(message.messageId);
		assert.equal(row.mailboxId, receipts.mailboxId);
		assert.equal(row.status, "moving");
	});
});

describe("CHANGEDSINCE picks up what another client changed", () => {
	const seeded = async (count = 1) => {
		const uids: number[] = [];
		for (let i = 0; i < count; i++) {
			uids.push(
				imap.deliver("INBOX", eml({ "Message-ID": `<m${i}@example.com>` })),
			);
		}
		await settle(inbox);
		logMark = imap.log.length;
		const messages = await Promise.all(
			uids.map((uid) => messageAtUid(store, inbox, uid)),
		);
		return { uids, messages };
	};

	it("applies a read-state change without enumerating the folder", async () => {
		const {
			uids: [uid],
			messages: [message],
		} = await seeded();
		imap.store("INBOX", [uid], [MessageSystemFlag.Seen]);

		await sync(inbox);

		assert.equal(sent("SEARCH"), 0);
		assert.equal((await threadOf(message.messageId)).isRead, true);
		assert.ok(
			await store.messageFlag.hasFlag(
				message.messageId,
				MessageSystemFlag.Seen,
			),
		);
	});

	it("stars with the default colour and unstars clearing it", async () => {
		const {
			uids: [uid],
			messages: [message],
		} = await seeded();
		imap.store("INBOX", [uid], [MessageSystemFlag.Flagged]);
		await sync(inbox);
		let thread = await threadOf(message.messageId);
		assert.equal(thread.hasStars, true);
		assert.equal(thread.star, "yellow");

		imap.store("INBOX", [uid], []);
		await sync(inbox);

		thread = await threadOf(message.messageId);
		assert.equal(thread.hasStars, false);
		assert.equal(thread.star, "none");
		assert.equal(
			await store.messageFlag.hasFlag(
				message.messageId,
				MessageSystemFlag.Flagged,
			),
			false,
		);
	});

	it("keeps a colour the user chose when the server re-flags", async () => {
		const {
			uids: [uid],
			messages: [message],
		} = await seeded();
		await flagQueue().updateFlags(
			account.accountConfigId,
			message.messageId,
			account.accountId,
			{ isStarred: false, starColor: "purple" },
		);
		await store.flagPush.delete(message.messageId, MessageSystemFlag.Flagged);
		imap.store("INBOX", [uid], [MessageSystemFlag.Flagged]);

		await sync(inbox);

		assert.equal((await threadOf(message.messageId)).star, "purple");
	});

	it("leaves a field alone while the user's flip is still owed to the server", async () => {
		const {
			uids: [uid],
			messages: [message],
		} = await seeded();
		const flags = new FlagQueueService({
			messageFlagService: store.messageFlag,
			messageService: store.message,
			threadMessageService: store.threadMessage,
			flagPushService: flagPushService(),
		});
		await flags.markAsRead(
			account.accountConfigId,
			message.messageId,
			account.accountId,
		);
		imap.store("INBOX", [uid], [MessageSystemFlag.Flagged]);

		await sync(inbox);

		const thread = await threadOf(message.messageId);
		assert.equal(thread.isRead, true);
		assert.equal(thread.hasStars, true);
	});

	it("leaves the user's next flip a real flip", async () => {
		const {
			uids: [uid],
			messages: [message],
		} = await seeded();
		imap.store("INBOX", [uid], [MessageSystemFlag.Seen]);
		await sync(inbox);

		await new FlagQueueService({
			messageFlagService: store.messageFlag,
			messageService: store.message,
			threadMessageService: store.threadMessage,
			flagPushService: flagPushService(),
		}).markAsUnread(
			account.accountConfigId,
			message.messageId,
			account.accountId,
		);

		assert.equal(
			(await store.flagPush.find(message.messageId, MessageSystemFlag.Seen))
				?.operation,
			"remove",
		);
		assert.equal((await threadOf(message.messageId)).isRead, false);
	});

	it("mirrors $Junk and $NotJunk as message state, never as sender standing", async () => {
		const {
			uids: [first, second],
			messages: [junked, cleared],
		} = await seeded(2);
		const before = await address("sender@example.com");
		imap.store("INBOX", [first], [MessageKeywordFlag.Junk]);
		imap.store("INBOX", [second], [MessageKeywordFlag.NotJunk]);

		await sync(inbox);

		assert.ok(
			await store.messageFlag.hasFlag(
				junked.messageId,
				MessageKeywordFlag.Junk,
			),
		);
		assert.ok(
			await store.messageFlag.hasFlag(
				cleared.messageId,
				MessageKeywordFlag.NotJunk,
			),
		);
		assert.deepEqual((await address("sender@example.com")).flags, before.flags);
	});

	it("discovers new mail and hands it to body sync", async () => {
		await seeded();
		const uid = imap.deliver(
			"INBOX",
			eml({ "Message-ID": "<new@example.com>" }),
		);

		const result = await sync(inbox);

		assert.equal(sent("SEARCH"), 0);
		assert.deepEqual(
			result.syncedMessages.map((message) => message.uid),
			[uid],
		);
		assert.equal((await stored(inbox)).highWaterMarkUid, uid);
		assert.equal(
			(await stored(inbox)).highestModseq,
			imap.highestModseq().toString(),
		);
	});

	it("splits one bulk change across rounds without losing its tail", async () => {
		const { uids, messages } = await seeded(60);
		imap.store("INBOX", uids, [MessageSystemFlag.Seen]);

		const first = await sync(inbox, 50);
		assert.equal(first.hasMore, true);
		imap.store("INBOX", uids, [
			MessageSystemFlag.Seen,
			MessageSystemFlag.Flagged,
		]);
		await settle(inbox);

		for (const message of messages) {
			const thread = await threadOf(message.messageId);
			assert.equal(thread.isRead, true);
			assert.equal(thread.hasStars, true);
		}
		assert.equal(
			(await stored(inbox)).highestModseq,
			imap.highestModseq().toString(),
		);
	});
});

describe("a server without CONDSTORE", () => {
	it("enumerates every round and never seeds a mod-sequence", async () => {
		imap.condstore = false;
		imap.deliver("INBOX", eml({}));
		await settle(inbox);

		await sync(inbox);

		assert.equal(sent("FETCH", "CHANGEDSINCE"), 0);
		assert.ok(sent("SEARCH") > 0);
		assert.equal((await stored(inbox)).highestModseq, "0");
	});

	it("seeds the mod-sequence only once enumeration has nothing left", async () => {
		imap.deliver("INBOX", eml({ "Message-ID": "<a@example.com>" }));
		imap.deliver("INBOX", eml({ "Message-ID": "<b@example.com>" }));

		await sync(inbox, 1);
		assert.equal((await stored(inbox)).highestModseq, "0");

		await settle(inbox);
		assert.equal(
			(await stored(inbox)).highestModseq,
			imap.highestModseq().toString(),
		);
	});
});

describe("a UIDVALIDITY change", () => {
	it("trips the cursor, then rebuilds on the new axis and reseeds", async () => {
		imap.deliver("INBOX", eml({ "Message-ID": "<a@example.com>" }));
		await settle(inbox);
		imap.renumber("INBOX", 777);

		const tripped = await sync(inbox);
		assert.deepEqual(tripped.syncedMessages, []);
		assert.equal(
			(await stored(inbox)).cursorState,
			MailboxCursorState.cursor_invalid,
		);

		await sync(inbox);

		const rebuilt = await stored(inbox);
		assert.equal(rebuilt.cursorState, MailboxCursorState.normal);
		assert.equal(rebuilt.uidValidity, 777);
		assert.equal(rebuilt.highestModseq, imap.highestModseq().toString());
	});

	it("withholds the seed and the watermark when the rebuild missed a UID", async () => {
		for (const id of ["a", "b", "c"]) {
			imap.deliver("INBOX", eml({ "Message-ID": `<${id}@example.com>` }));
		}
		await settle(inbox);
		imap.renumber("INBOX", 777);
		const arrived = imap.deliver(
			"INBOX",
			eml({ "Message-ID": "<d@example.com>" }),
		);
		await sync(inbox);
		const fetch = connection.fetchMessages;
		connection.fetchMessages = async (uids) =>
			(await fetch(uids)).filter((row) => row.uid !== arrived);

		await sync(inbox);

		const rebuilt = await stored(inbox);
		assert.equal(rebuilt.highestModseq, "0");
		assert.ok(rebuilt.highWaterMarkUid < arrived);
	});
});

describe("a FETCH that leaves a UID unaccounted for", () => {
	it("holds the watermark below a row the FETCH dropped", async () => {
		for (const id of ["a", "b", "c"]) {
			imap.deliver("INBOX", eml({ "Message-ID": `<${id}@example.com>` }));
		}
		const fetch = connection.fetchMessages;
		connection.fetchMessages = async (uids) =>
			(await fetch(uids)).filter((row) => row.uid !== 2);

		await sync(inbox);

		const mailbox = await stored(inbox);
		assert.equal(mailbox.highWaterMarkUid, 1);
		assert.equal(mailbox.highestModseq, "0");
	});

	it("holds a row with no ENVELOPE for retry rather than setting it aside", async () => {
		imap.deliver("INBOX", eml({}));
		const fetch = connection.fetchMessages;
		connection.fetchMessages = async (uids) =>
			(await fetch(uids)).map((row) => ({ ...row, envelope: undefined }));

		const result = await sync(inbox);

		assert.equal(result.syncedCount, 0);
		assert.equal((await stored(inbox)).highWaterMarkUid, 0);
		assert.deepEqual(
			await store.quarantine.listByAccountConfigId(account.accountConfigId),
			[],
		);
	});

	it("passes over a UID already quarantined without fetching it", async () => {
		const first = imap.deliver(
			"INBOX",
			eml({ "Message-ID": "<a@example.com>" }),
		);
		const second = imap.deliver(
			"INBOX",
			eml({ "Message-ID": "<b@example.com>" }),
		);
		await new QuarantineService(
			store.quarantine,
			store.mailboxSpecialUse,
			"sha-test",
			silentLog,
		).record(
			{
				accountId: account.accountId,
				accountConfigId: account.accountConfigId,
				mailboxId: inbox.mailboxId,
				mailboxPath: "INBOX",
				uidValidity: 7,
				attempts: 3,
			},
			first,
			{ stage: "BodyParse", code: "UnreadableBody", message: "no" },
		);
		const asked: number[][] = [];
		const fetch = connection.fetchMessages;
		connection.fetchMessages = async (uids) => {
			asked.push(uids);
			return fetch(uids);
		};

		await sync(inbox);

		assert.deepEqual(asked, [[second]]);
		assert.equal((await stored(inbox)).highWaterMarkUid, second);
	});
});
