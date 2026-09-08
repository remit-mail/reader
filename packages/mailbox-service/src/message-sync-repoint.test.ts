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
import { deriveMessageId } from "@remit/data-ports/id";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { type DepartureVerdicts, placementKey } from "./external-move.js";
import { type AccountFolderRoles, MessageSyncService } from "./message-sync.js";
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
	unresolved: boolean;
}

/**
 * What `confirmDepartures` had answered about the stored placement by the time
 * the batch was saved (#1146).
 *
 * - `departed` — the source folder no longer holds it: a move another client made.
 * - `held` — the source folder still holds it: the labelled message, in two
 *   folders at once.
 * - `none` — no verdict at all: the source could not be asked this round.
 * - `stale` — a verdict, but for a placement this row no longer has, because it
 *   moved between the probe and the save.
 */
type Verdict = "departed" | "held" | "none" | "stale";

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
	verdict: Verdict = "departed",
): Promise<Observed> => {
	const observed: Observed = {
		repointedTo: [],
		threadUpdates: [],
		reconciled: [],
		owned: false,
		unresolved: false,
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

	const answeredFor = placementKey(
		deriveMessageId("acct-1", envelope.messageId),
		stored.mailboxId,
		verdict === "stale" ? stored.uid + 1 : stored.uid,
	);
	const departures: DepartureVerdicts = {
		departed:
			verdict === "held" || verdict === "none"
				? new Set()
				: new Set([answeredFor]),
		settled: verdict === "none" ? new Set() : new Set([answeredFor]),
	};

	const result = (await (
		service as unknown as {
			saveMessage: (
				mailbox: MailboxItem,
				accountId: string,
				accountConfigId: string,
				msg: ImapMessage,
				roles: AccountFolderRoles,
				departures: DepartureVerdicts,
			) => Promise<{ owned: boolean; unresolvedSighting: boolean }>;
		}
	).saveMessage(
		sighting,
		"acct-1",
		"cfg-1",
		msg,
		{
			junkMailboxId: JUNK.mailboxId,
			trashMailboxId: TRASH.mailboxId,
			configJunkRoles: NO_JUNK_ROLES,
		},
		departures,
	)) as { owned: boolean; unresolvedSighting: boolean };

	observed.owned = result.owned;
	observed.unresolved = result.unresolvedSighting;
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

	/**
	 * The reported bug (#1146): a message that legitimately sits in two real
	 * folders — a Gmail user label, a Sieve `fileinto` beside a `keep`, a Sent
	 * copy a list echoes back — was re-pointed out of the Inbox by whichever
	 * folder the round enumerated last.
	 */
	it("leaves a labelled message in the folder that still holds it", async () => {
		const observed = await sync(
			mailboxAt("Receipts"),
			storedIn(INBOX),
			threadRowIn(INBOX),
			[],
			"held",
		);

		assert.deepEqual(observed.repointedTo, []);
		assert.deepEqual(observed.threadUpdates, []);
		assert.equal(observed.owned, false);
	});

	/**
	 * A decided sighting is decided for good: the message is in two folders and
	 * asking again next round would get the same answer. Only an UNDECIDED one
	 * comes back, so a settled decline must not hold the watermark.
	 */
	it("finishes with a labelled message rather than holding the watermark for it", async () => {
		const observed = await sync(
			mailboxAt("Receipts"),
			storedIn(INBOX),
			threadRowIn(INBOX),
			[],
			"held",
		);

		assert.equal(observed.unresolved, false);
	});

	it("holds the watermark when the source folder could not be asked", async () => {
		const observed = await sync(
			JUNK,
			storedIn(INBOX),
			threadRowIn(INBOX),
			[],
			"none",
		);

		assert.deepEqual(observed.repointedTo, []);
		assert.equal(observed.unresolved, true);
	});

	/**
	 * The probe reads the row outside the transaction that acts on it, so a user
	 * move landing in between leaves a verdict about a placement this row no
	 * longer has. Spending it would re-point the row against an answer reached
	 * for somewhere else.
	 */
	it("spends no verdict reached for a placement the row has since left", async () => {
		const observed = await sync(
			JUNK,
			storedIn(INBOX),
			threadRowIn(INBOX),
			[],
			"stale",
		);

		assert.deepEqual(observed.repointedTo, []);
		assert.equal(observed.unresolved, true);
	});

	it("holds the watermark for nothing when the row is already ours", async () => {
		const observed = await sync(
			INBOX,
			storedIn(INBOX),
			threadRowIn(INBOX),
			[],
			"none",
		);

		assert.equal(observed.unresolved, false);
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
