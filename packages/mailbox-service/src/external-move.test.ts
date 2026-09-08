import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IMailboxRepository,
	IMessageRepository,
	MailboxItem,
	MessageItem,
} from "@remit/data-ports";
import { MessageStatus, MessageSyncStatus } from "@remit/domain-enums";
import {
	confirmDepartures,
	placementKey,
	sightingContestsPlacement,
} from "./external-move.js";
import type { IImapConnection } from "./types.js";

const mailboxAt = (
	fullPath: string,
	specialUse?: string[],
	uidValidity = 1,
): MailboxItem =>
	({
		mailboxId: `mbx-${fullPath}`,
		fullPath,
		uidValidity,
		hierarchyDelimiter: "/",
		...(specialUse ? { specialUse } : {}),
	}) as MailboxItem;

const INBOX = mailboxAt("INBOX");
const LABEL = mailboxAt("Receipts");
const JUNK = mailboxAt("INBOX/Rubbish");
const ALL_MAIL = mailboxAt("[Gmail]/All Mail", ["All"]);

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

interface Probe {
	opened: string[];
	searches: number;
	departed: Set<string>;
}

/**
 * Ask whether the messages this batch sighted in `sightedIn` have left the
 * folders their rows point at, against a server where `held` names the uids each
 * folder still holds and `served` the UIDVALIDITY it answers on SELECT.
 */
const probe = async (
	sightedIn: MailboxItem,
	rows: MessageItem[],
	held: Record<string, number[]>,
	served: Record<string, number> = {},
	sources: MailboxItem[] = [INBOX],
): Promise<Probe> => {
	const opened: string[] = [];
	let searches = 0;

	const connection = {
		openBox: async (fullPath: string) => {
			opened.push(fullPath);
			const source = sources.find((box) => box.fullPath === fullPath);
			return { uidvalidity: served[fullPath] ?? source?.uidValidity ?? 1 };
		},
		search: async () => {
			searches += 1;
			const current = opened[opened.length - 1];
			return held[current] ?? [];
		},
	} as unknown as Pick<IImapConnection, "openBox" | "search">;

	const departed = await confirmDepartures(
		{
			connection,
			mailboxService: {
				get: async (_accountId: string, mailboxId: string) => {
					const source = sources.find((box) => box.mailboxId === mailboxId);
					if (!source) throw new Error(`no such mailbox: ${mailboxId}`);
					return source;
				},
			} as unknown as Pick<IMailboxRepository, "get">,
			messageService: {
				get: async () => rows,
			} as unknown as Pick<IMessageRepository, "get">,
			log: { info: () => {}, warn: () => {} },
		},
		"acct-1",
		sightedIn,
		rows.map((row) => row.messageId),
	);

	return { opened, searches, departed };
};

describe("whether a sighting in a second folder is a move", () => {
	/**
	 * The reported bug (#1146). A Gmail user label, a Sieve `fileinto` beside a
	 * `keep` and a Sent copy a list echoes back all put one message in two real
	 * folders. Reading the second folder's sighting as a move took the message
	 * out of the Inbox on the round that enumerated the label.
	 */
	it("is not a move while the folder the row points at still holds it", async () => {
		const observed = await probe(LABEL, [storedIn(INBOX)], {
			INBOX: [7],
		});

		assert.deepEqual([...observed.departed], []);
	});

	it("is a move once the folder the row points at has let it go", async () => {
		const observed = await probe(LABEL, [storedIn(INBOX)], {
			INBOX: [3, 11],
		});

		assert.deepEqual(
			[...observed.departed],
			[placementKey("msg-1", INBOX.mailboxId, 7)],
		);
	});

	it("names the placement it was answered for, so a row that moved since is left alone", async () => {
		const observed = await probe(JUNK, [storedIn(INBOX, { uid: 42 })], {
			INBOX: [],
		});

		assert.equal(
			observed.departed.has(placementKey("msg-1", INBOX.mailboxId, 7)),
			false,
		);
		assert.equal(
			observed.departed.has(placementKey("msg-1", INBOX.mailboxId, 42)),
			true,
		);
	});

	it("asks each source folder once for the whole batch", async () => {
		const observed = await probe(
			LABEL,
			[
				storedIn(INBOX, { messageId: "msg-1", uid: 7 }),
				storedIn(INBOX, { messageId: "msg-2", uid: 8 }),
				storedIn(INBOX, { messageId: "msg-3", uid: 9 }),
			],
			{ INBOX: [7] },
		);

		assert.deepEqual(observed.opened, ["INBOX"]);
		assert.equal(observed.searches, 1);
	});

	it("asks nothing at all when no row is contested", async () => {
		const observed = await probe(INBOX, [storedIn(INBOX)], { INBOX: [7] });

		assert.deepEqual(observed.opened, []);
		assert.deepEqual([...observed.departed], []);
	});

	it("asks nothing for a folder that holds a copy of every message", async () => {
		const observed = await probe(ALL_MAIL, [storedIn(INBOX)], { INBOX: [] });

		assert.deepEqual(observed.opened, []);
		assert.deepEqual([...observed.departed], []);
	});

	it("asks nothing for a row whose own mutation has not settled", async () => {
		const observed = await probe(
			LABEL,
			[storedIn(INBOX, { status: MessageStatus.moving })],
			{ INBOX: [] },
		);

		assert.deepEqual(observed.opened, []);
		assert.deepEqual([...observed.departed], []);
	});

	/**
	 * A uid means nothing without the axis it was issued on (RFC 9051 2.3.1.1),
	 * so a source that answers a different UIDVALIDITY is evidence of nothing.
	 * The cursor rebuild re-keys that folder; until it has, the sighting waits.
	 */
	it("refuses a source folder that has been re-keyed under it", async () => {
		const observed = await probe(
			LABEL,
			[storedIn(INBOX)],
			{ INBOX: [] },
			{
				INBOX: 99,
			},
		);

		assert.deepEqual([...observed.departed], []);
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
