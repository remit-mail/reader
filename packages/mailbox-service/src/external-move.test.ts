import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem, MessageItem } from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import {
	confirmDepartures,
	placementKey,
	sightingContestsPlacement,
} from "./external-move.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
	silentLog,
} from "./test-helpers/test-store.js";

const mailboxAt = (fullPath: string): MailboxItem =>
	({
		mailboxId: `mbx-${fullPath}`,
		fullPath,
		uidValidity: 1,
		hierarchyDelimiter: "/",
	}) as MailboxItem;

const INBOX = mailboxAt("INBOX");
const JUNK = mailboxAt("INBOX/Rubbish");

const storedIn = (
	mailbox: MailboxItem,
	overrides: Partial<MessageItem> = {},
): MessageItem =>
	({
		messageId: "msg-1",
		mailboxId: mailbox.mailboxId,
		uid: 7,
		status: MessageStatus.active,
		syncStatus: MessageSyncStatus.pending,
		...overrides,
	}) as MessageItem;

let store: Store;
let imap: FakeImapServer;
let account: AccountItem;
let inbox: MailboxItem;
let receipts: MailboxItem;
let allMail: MailboxItem;

beforeEach(async () => {
	store = await openStore();
	imap = new FakeImapServer();
	account = await seedAccount(store);
	inbox = await seedMailbox(store, account, "INBOX");
	receipts = await seedMailbox(store, account, "Receipts");
	allMail = await seedMailbox(store, account, "[Gmail]/All Mail", {
		specialUse: "All",
	});
	for (const path of ["INBOX", "Receipts", "[Gmail]/All Mail"]) {
		imap.addFolder(path);
	}
});

afterEach(() => store.close());

const rowsIn = async (mailbox: MailboxItem, count: number) => {
	const ids: string[] = [];
	for (let i = 0; i < count; i++) {
		const uid = imap.deliver(mailbox.fullPath, eml({}));
		ids.push(
			(await seedMessage(store, account, mailbox, uid)).message.messageId,
		);
	}
	return ids;
};

const probe = async (sightedIn: MailboxItem, messageIds: string[]) => {
	const connection = imap.connection();
	const before = imap.log.length;
	const verdicts = await confirmDepartures(
		{
			connection,
			mailboxService: store.mailbox,
			messageService: store.message,
			log: silentLog,
		},
		account.accountId,
		sightedIn,
		messageIds,
	);
	const asked = imap.log.slice(before);
	return {
		...verdicts,
		opened: asked.filter((line) => /^(SELECT|EXAMINE) /.test(line)),
		searched: asked.filter((line) => line.startsWith("SEARCH ")),
	};
};

describe("whether a sighting in a second folder is a move", () => {
	it("asks each source folder once, about the contested uids only", async () => {
		const ids = await rowsIn(inbox, 3);
		imap.expunge("INBOX", 2);

		const observed = await probe(receipts, ids);

		assert.deepEqual(observed.opened, ["EXAMINE INBOX"]);
		assert.equal(observed.searched.length, 1);
		const [, uids] = /"UID","([\d,]+)"/.exec(observed.searched[0]) ?? [];
		assert.deepEqual(uids?.split(",").sort(), ["1", "2", "3"]);
		assert.deepEqual(
			[...observed.departed],
			[placementKey(ids[1], inbox.mailboxId, 2)],
		);
		assert.equal(observed.settled.size, 3);
	});

	it("asks nothing when no row is contested", async () => {
		const ids = await rowsIn(inbox, 1);

		const observed = await probe(inbox, ids);

		assert.deepEqual(observed.opened, []);
	});

	it("frees a row whose source copies every message, without asking it", async () => {
		const ids = await rowsIn(allMail, 1);

		const observed = await probe(receipts, ids);

		assert.deepEqual(observed.opened, []);
		assert.deepEqual(
			[...observed.departed],
			[placementKey(ids[0], allMail.mailboxId, 1)],
		);
	});

	it("leaves a source it cannot reach undecided rather than failing the round", async () => {
		const ids = await rowsIn(inbox, 1);
		imap.removeFolder("INBOX");

		const observed = await probe(receipts, ids);

		assert.equal(observed.departed.size, 0);
		assert.equal(observed.settled.size, 0);
	});

	it("asks for a save only where the placement changes or is undecided", async () => {
		const [held, gone] = await rowsIn(inbox, 2);
		imap.expunge("INBOX", 2);

		const decided = await probe(receipts, [held, gone]);
		imap.removeFolder("INBOX");
		const undecided = await probe(receipts, [held]);

		assert.deepEqual([...decided.needsSave], [gone]);
		assert.deepEqual([...undecided.needsSave], [held]);
	});

	it("refuses a source folder re-keyed under it", async () => {
		const ids = await rowsIn(inbox, 1);
		imap.expunge("INBOX", 1);
		imap.renumber("INBOX", 99);

		const observed = await probe(receipts, ids);

		assert.equal(observed.departed.size, 0);
		assert.equal(observed.settled.size, 0);
	});
});

describe("sightingContestsPlacement", () => {
	it("refuses a Gmail virtual folder the server never flagged", () => {
		assert.equal(
			sightingContestsPlacement(mailboxAt("[Gmail]/All Mail"), storedIn(INBOX)),
			false,
		);
	});

	it("accepts a folder the user named after a virtual one", () => {
		assert.equal(
			sightingContestsPlacement(mailboxAt("Starred ideas"), storedIn(INBOX)),
			true,
		);
	});

	it("accepts an ordinary inbound row the sync path left pending", () => {
		assert.equal(
			sightingContestsPlacement(
				JUNK,
				storedIn(INBOX, { syncStatus: MessageSyncStatus.pending }),
			),
			true,
		);
	});

	it("accepts a row a settled mutation marked synced", () => {
		assert.equal(
			sightingContestsPlacement(
				JUNK,
				storedIn(INBOX, { syncStatus: MessageSyncStatus.synced }),
			),
			true,
		);
	});

	/**
	 * The row `abandonDelete` hands back: reader refused the delete, put the
	 * message back where the server still has it, and nothing else is coming
	 * for the row. Reader shares its mailboxes, so the user moving that same
	 * message in another client is ordinary — and before R3 the sighting was
	 * refused on `syncStatus` alone and the row never followed the move.
	 */
	it("accepts a row whose delete was abandoned, so a move made elsewhere still lands", () => {
		assert.equal(
			sightingContestsPlacement(
				JUNK,
				storedIn(INBOX, {
					status: MessageStatus.active,
					syncStatus: MessageSyncStatus.abandoned,
				}),
			),
			true,
		);
	});

	it("accepts a row left `failed` by a transient attempt that has since settled", () => {
		assert.equal(
			sightingContestsPlacement(
				JUNK,
				storedIn(INBOX, { syncStatus: MessageSyncStatus.failed }),
			),
			true,
		);
	});

	it("refuses a row whose own move is still in flight", () => {
		assert.equal(
			sightingContestsPlacement(
				JUNK,
				storedIn(INBOX, {
					status: MessageStatus.moving,
					syncStatus: MessageSyncStatus.pending,
				}),
			),
			false,
		);
	});

	it("refuses a row whose own delete is still in flight", () => {
		assert.equal(
			sightingContestsPlacement(
				JUNK,
				storedIn(INBOX, {
					status: MessageStatus.deleting,
					syncStatus: MessageSyncStatus.pending,
				}),
			),
			false,
		);
	});
});
