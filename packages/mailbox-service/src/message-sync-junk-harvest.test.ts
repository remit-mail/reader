/**
 * Sync harvested a contact off every envelope it ever saw, and a Junk folder is
 * full of envelopes the account never asked for: a forged From, the whole list
 * a spam run was blind-copied to. All of them became autocomplete suggestions,
 * indistinguishable from a real correspondent — 517 of them on the instance
 * that was hit, which is how the spoofed name in #826 found a slot to ride
 * (issue #822).
 *
 * The mailbox's special-use designation decides it, so the same message reached
 * through an ordinary folder is harvested normally. That is what makes a move
 * work in both directions without a cross-folder query.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CreateAddressInput,
	CreateEnvelopeAddressInput,
	CreateThreadMessageInput,
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageRepository,
	IThreadMessageRepository,
	MailboxItem,
	MessageItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import { MailboxSpecialUse } from "@remit/domain-enums";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { harvestsAddresses, MessageSyncService } from "./message-sync.js";
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

interface Saved {
	harvested: CreateAddressInput[];
	withheld: CreateAddressInput[];
	envelopeAddresses: CreateEnvelopeAddressInput[];
}

const mailboxIn = (specialUse: MailboxItem["specialUse"]): MailboxItem =>
	({ mailboxId: "mbx-1", fullPath: "INBOX/Spam", specialUse }) as MailboxItem;

/**
 * Drive the real save path so the routing under test is the one the write path
 * takes, not one a test handed to a private method.
 */
const save = async (mailbox: MailboxItem): Promise<Saved> => {
	const saved: Saved = { harvested: [], withheld: [], envelopeAddresses: [] };

	const messageService = {
		upsertWithStatus: async (input: unknown) => ({
			item: input as MessageItem,
			created: true,
		}),
	} as unknown as IMessageRepository;

	const threadMessageService = {
		create: async (input: CreateThreadMessageInput) =>
			input as unknown as ThreadMessageItem,
	} as unknown as IThreadMessageRepository;

	const envelopeService = {
		upsertEnvelope: async () => {},
		upsertBodyParts: async () => {},
	} as unknown as IEnvelopeRepository;

	const addressService = {
		upsertAddress: async (input: CreateAddressInput) => {
			saved.harvested.push(input);
		},
		upsertJunkAddress: async (input: CreateAddressInput) => {
			saved.withheld.push(input);
		},
		upsertEnvelopeAddress: async (input: CreateEnvelopeAddressInput) => {
			saved.envelopeAddresses.push(input);
		},
	} as unknown as IAddressRepository;

	const service = new MessageSyncService(
		stub<ManagedConnectionFactory>(),
		stub<IMailboxRepository>(),
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

	await (
		service as unknown as {
			saveMessage: (
				mailbox: MailboxItem,
				accountId: string,
				accountConfigId: string,
				msg: ImapMessage,
			) => Promise<unknown>;
		}
	).saveMessage(mailbox, "acct-1", "cfg-1", msg);

	return saved;
};

describe("which mailboxes feed the address book", () => {
	it("reads the designation, not the folder name", () => {
		assert.equal(
			harvestsAddresses({ specialUse: [MailboxSpecialUse.Junk] }),
			false,
		);
		assert.equal(harvestsAddresses({ specialUse: undefined }), true);
	});

	/**
	 * Deleted mail is largely correspondence the account chose to be done with,
	 * not mail it never asked for, so Trash keeps feeding the address book.
	 */
	it("keeps harvesting from Trash", () => {
		assert.equal(
			harvestsAddresses({ specialUse: [MailboxSpecialUse.Trash] }),
			true,
		);
	});

	it("harvests every envelope address of an ordinary message", async () => {
		const saved = await save(mailboxIn(undefined));

		assert.deepEqual(
			saved.harvested.map((input) => input.normalizedEmail),
			["sales@pharma.example", "victim@ischen.nl"],
		);
		assert.equal(saved.withheld.length, 0);
	});

	it("withholds every envelope address of a message in Junk", async () => {
		const saved = await save(mailboxIn([MailboxSpecialUse.Junk]));

		assert.deepEqual(
			saved.withheld.map((input) => input.normalizedEmail),
			["sales@pharma.example", "victim@ischen.nl"],
		);
		assert.equal(saved.harvested.length, 0);
	});

	/**
	 * The message still has to render its own From, To and Cc. What Junk decides
	 * is whether the address behind them enters the address book.
	 */
	it("still records the envelope a message in Junk renders", async () => {
		const saved = await save(mailboxIn([MailboxSpecialUse.Junk]));

		assert.deepEqual(
			saved.envelopeAddresses.map((input) => input.normalizedEmail),
			["sales@pharma.example", "victim@ischen.nl"],
		);
	});

	/**
	 * A mailbox can carry more than one designation, and Junk anywhere in the set
	 * is what decides.
	 */
	it("withholds when Junk is one designation among several", async () => {
		const saved = await save(
			mailboxIn([MailboxSpecialUse.Junk, MailboxSpecialUse.Archive]),
		);

		assert.equal(saved.harvested.length, 0);
		assert.equal(saved.withheld.length, 2);
	});

	/**
	 * The same message, reached through the folder it was moved into. Sync saves
	 * it again there, and that save harvests — which is how an address rescued
	 * out of Junk gets back into autocomplete, and how a message that also sits
	 * in an ordinary folder is harvested from that folder.
	 */
	it("harvests the same message once an ordinary folder holds it", async () => {
		await save(mailboxIn([MailboxSpecialUse.Junk]));
		const moved = await save(mailboxIn(undefined));

		assert.deepEqual(
			moved.harvested.map((input) => input.normalizedEmail),
			["sales@pharma.example", "victim@ischen.nl"],
		);
	});
});
