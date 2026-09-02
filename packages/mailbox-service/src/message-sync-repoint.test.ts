import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MailboxItem,
	MessageItem,
	ThreadMessageItem,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import {
	type AccountFolderRoles,
	MessageSyncService,
	repointsOnSighting,
} from "./message-sync.js";
import { folderRoles, NO_JUNK_ROLES } from "./test-helpers/folder-roles.js";
import type { ImapEnvelope, ImapMessage } from "./types.js";

const stub = <T>(): T => ({}) as T;

const envelope: ImapEnvelope = {
	date: new Date(0).toISOString(),
	messageId: "<root@example.com>",
	subject: "Subject",
	from: [{ name: "Pharma Deals", mailbox: "sales", host: "pharma.example" }],
	sender: [],
	replyTo: [],
	to: [{ name: "", mailbox: "victim", host: "ischen.nl" }],
	cc: [],
	bcc: [],
	inReplyTo: "",
};

const mailboxAt = (fullPath: string, specialUse?: string[]): MailboxItem =>
	({
		mailboxId: `mbx-${fullPath}`,
		fullPath,
		hierarchyDelimiter: "/",
		...(specialUse ? { specialUse } : {}),
	}) as MailboxItem;

const INBOX = mailboxAt("INBOX");
const JUNK = mailboxAt("INBOX/Rubbish");
const TRASH = mailboxAt("Trash");
const ALL_MAIL = mailboxAt("[Gmail]/All Mail", ["All"]);

/**
 * `pending` is what an ordinary inbound row carries: `upsertWithStatus` is
 * called without a `syncStatus` and the repository defaults to it, and nothing
 * on the sync path ever promotes it (#1096). The fixture states the reachable
 * state, not the one the gate used to demand.
 */
const storedIn = (
	mailbox: MailboxItem,
	overrides: Partial<MessageItem> = {},
): MessageItem =>
	({
		mailboxId: mailbox.mailboxId,
		uid: 7,
		status: MessageStatus.active,
		syncStatus: MessageSyncStatus.pending,
		...overrides,
	}) as MessageItem;

const threadRowIn = (mailbox: MailboxItem): ThreadMessageItem =>
	({
		threadMessageId: "tm-1",
		accountConfigId: "cfg-1",
		mailboxId: mailbox.mailboxId,
		uid: 7,
		sentDate: 0,
		isRead: false,
		isDeleted: mailbox === TRASH,
		hasStars: false,
		hasAttachment: false,
	}) as ThreadMessageItem;

interface Observed {
	repointedTo: Array<{ mailboxId: string; uid: number }>;
	threadUpdates: UpdateThreadMessageInput[];
	reconciled: string[];
	owned: boolean;
}

/**
 * Sync one message out of `sighting`, against a database that already holds it
 * under `stored`. The account's Junk folder is `JUNK` and its Trash is `TRASH`,
 * so the sighting's own role follows from which mailbox it is.
 */
const sync = async (
	sighting: MailboxItem,
	stored: MessageItem,
	threadRow: ThreadMessageItem | null = threadRowIn(INBOX),
	copiesHere: MessageItem[] = [],
): Promise<Observed> => {
	const observed: Observed = {
		repointedTo: [],
		threadUpdates: [],
		reconciled: [],
		owned: false,
	};

	const messageService = {
		upsertWithStatus: async () => ({ item: stored, created: false }),
		get: async () => copiesHere,
		updateUid: async (_id: string, uid: number, mailboxId: string) => {
			observed.repointedTo.push({ mailboxId, uid });
			return stored;
		},
	} as unknown as IMessageRepository;

	const threadMessageService = {
		findByMessageId: async () => threadRow,
		update: async (
			_config: string,
			_id: string,
			input: UpdateThreadMessageInput,
		) => {
			observed.threadUpdates.push(input);
			return threadRow as ThreadMessageItem;
		},
		create: async (input: unknown) => input as ThreadMessageItem,
	} as unknown as IThreadMessageRepository;

	const envelopeService = {
		upsertEnvelope: async () => {},
		upsertBodyParts: async () => {},
	} as unknown as IEnvelopeRepository;

	const addressService = {
		upsertCorrespondentAddress: async () => {},
		upsertJunkAddress: async () => {},
		upsertAddress: async () => {},
		upsertEnvelopeAddress: async () => {},
		reconcileJunkOnlyForMessage: async (messageId: string) => {
			observed.reconciled.push(messageId);
		},
	} as unknown as IAddressRepository;

	const service = new MessageSyncService(
		stub<ManagedConnectionFactory>(),
		stub<IMailboxRepository>(),
		folderRoles({
			junkMailboxId: JUNK.mailboxId,
			trashMailboxId: TRASH.mailboxId,
		}),
		messageService,
		envelopeService,
		addressService,
		threadMessageService,
	);

	const msg = {
		uid: 42,
		seq: 1,
		size: 100,
		internalDate: new Date(0),
		flags: [],
		envelope,
	} as unknown as ImapMessage;

	const result = (await (
		service as unknown as {
			saveMessage: (
				mailbox: MailboxItem,
				accountId: string,
				accountConfigId: string,
				msg: ImapMessage,
				roles: AccountFolderRoles,
			) => Promise<{ owned: boolean }>;
		}
	).saveMessage(sighting, "acct-1", "cfg-1", msg, {
		junkMailboxId: JUNK.mailboxId,
		trashMailboxId: TRASH.mailboxId,
		configJunkRoles: NO_JUNK_ROLES,
	})) as { owned: boolean };

	observed.owned = result.owned;
	return observed;
};

describe("which folder a message the database already holds lives in", () => {
	it("follows the last move when another client files it into Junk", async () => {
		const observed = await sync(JUNK, storedIn(INBOX));

		assert.deepEqual(observed.repointedTo, [
			{ mailboxId: JUNK.mailboxId, uid: 42 },
		]);
	});

	it("follows the last move back when another client rescues it", async () => {
		const observed = await sync(INBOX, storedIn(JUNK), threadRowIn(JUNK));

		assert.deepEqual(observed.repointedTo, [
			{ mailboxId: INBOX.mailboxId, uid: 42 },
		]);
	});

	it("takes the UID of the folder that issued it, never the old one", async () => {
		const observed = await sync(JUNK, storedIn(INBOX, { uid: 7 }));

		assert.equal(observed.repointedTo[0].uid, 42);
	});

	it("leaves a row this folder already owns alone", async () => {
		const observed = await sync(INBOX, storedIn(INBOX));

		assert.deepEqual(observed.repointedTo, []);
		assert.equal(observed.owned, true);
	});

	it("holds a row whose own move has not settled", async () => {
		const observed = await sync(
			INBOX,
			storedIn(JUNK, {
				status: MessageStatus.moving,
				syncStatus: MessageSyncStatus.pending,
			}),
		);

		assert.deepEqual(observed.repointedTo, []);
		assert.equal(observed.owned, false);
	});

	it("declines a sighting in a folder that copies every message", async () => {
		const observed = await sync(ALL_MAIL, storedIn(INBOX));

		assert.deepEqual(observed.repointedTo, []);
		assert.equal(observed.owned, false);
	});

	it("declines a sighting of a copy the user put in this folder", async () => {
		const observed = await sync(JUNK, storedIn(INBOX), threadRowIn(INBOX), [
			storedIn(JUNK),
		]);

		assert.deepEqual(observed.repointedTo, []);
		assert.deepEqual(observed.threadUpdates, []);
	});

	it("hands the re-pointed message to this folder's body sync", async () => {
		const observed = await sync(JUNK, storedIn(INBOX));

		assert.equal(observed.owned, true);
	});
});

describe("what a re-pointed message does to the listing that renders it", () => {
	it("moves the row the listing and the folder counts read", async () => {
		const observed = await sync(JUNK, storedIn(INBOX));

		assert.deepEqual(observed.threadUpdates, [
			{ mailboxId: JUNK.mailboxId, uid: 42, isDeleted: false },
		]);
	});

	it("marks the row deleted when the move was into Trash", async () => {
		const observed = await sync(TRASH, storedIn(INBOX));

		assert.equal(observed.threadUpdates[0].isDeleted, true);
	});

	it("clears the deleted mark when the move was out of Trash", async () => {
		const observed = await sync(INBOX, storedIn(TRASH), threadRowIn(TRASH));

		assert.equal(observed.threadUpdates[0].isDeleted, false);
	});

	it("writes nothing when no row renders the message yet", async () => {
		const observed = await sync(JUNK, storedIn(INBOX), null);

		assert.deepEqual(observed.threadUpdates, []);
		assert.deepEqual(observed.repointedTo, [
			{ mailboxId: JUNK.mailboxId, uid: 42 },
		]);
	});
});

describe("what a re-pointed message does to its sender's standing", () => {
	it("re-asks the question when the move was into Junk", async () => {
		const observed = await sync(JUNK, storedIn(INBOX));

		assert.equal(observed.reconciled.length, 1);
	});

	it("re-asks it again when the move was back out of Junk", async () => {
		const observed = await sync(INBOX, storedIn(JUNK), threadRowIn(JUNK));

		assert.equal(observed.reconciled.length, 1);
	});

	it("asks nothing when the pointer did not move", async () => {
		const observed = await sync(INBOX, storedIn(INBOX));

		assert.deepEqual(observed.reconciled, []);
	});
});

describe("repointsOnSighting", () => {
	it("refuses a Gmail virtual folder the server never flagged", () => {
		assert.equal(
			repointsOnSighting(mailboxAt("[Gmail]/All Mail"), storedIn(INBOX)),
			false,
		);
	});

	it("accepts a folder the user named after a virtual one", () => {
		assert.equal(
			repointsOnSighting(mailboxAt("Starred ideas"), storedIn(INBOX)),
			true,
		);
	});

	it("accepts an ordinary inbound row the sync path left pending", () => {
		assert.equal(
			repointsOnSighting(
				JUNK,
				storedIn(INBOX, { syncStatus: MessageSyncStatus.pending }),
			),
			true,
		);
	});

	it("accepts a row a settled mutation marked synced", () => {
		assert.equal(
			repointsOnSighting(
				JUNK,
				storedIn(INBOX, { syncStatus: MessageSyncStatus.synced }),
			),
			true,
		);
	});

	it("refuses a row whose move failed and has not been re-tried", () => {
		assert.equal(
			repointsOnSighting(
				JUNK,
				storedIn(INBOX, { syncStatus: MessageSyncStatus.failed }),
			),
			false,
		);
	});

	it("refuses a row whose own move is still in flight", () => {
		assert.equal(
			repointsOnSighting(
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
			repointsOnSighting(
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
