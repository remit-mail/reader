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
import { addressSightingIn, MessageSyncService } from "./message-sync.js";
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
	correspondents: CreateAddressInput[];
	junk: CreateAddressInput[];
	neutral: CreateAddressInput[];
	envelopeAddresses: CreateEnvelopeAddressInput[];
}

const mailboxAt = (
	fullPath: string,
	specialUse?: MailboxItem["specialUse"],
): MailboxItem => ({ mailboxId: "mbx-1", fullPath, specialUse }) as MailboxItem;

const save = async (mailbox: MailboxItem): Promise<Saved> => {
	const saved: Saved = {
		correspondents: [],
		junk: [],
		neutral: [],
		envelopeAddresses: [],
	};

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
		upsertCorrespondentAddress: async (input: CreateAddressInput) => {
			saved.correspondents.push(input);
		},
		upsertJunkAddress: async (input: CreateAddressInput) => {
			saved.junk.push(input);
		},
		upsertAddress: async (input: CreateAddressInput) => {
			saved.neutral.push(input);
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

const emails = (inputs: Array<{ normalizedEmail: string }>): string[] =>
	inputs.map((input) => input.normalizedEmail);

const BOTH = ["sales@pharma.example", "victim@ischen.nl"];

describe("what a mailbox says about the addresses on its messages", () => {
	it("reads the special-use designation", () => {
		assert.equal(
			addressSightingIn({
				fullPath: "INBOX/Spam",
				specialUse: [MailboxSpecialUse.Junk],
			}),
			"junk",
		);
		assert.equal(addressSightingIn({ fullPath: "INBOX" }), "correspondent");
	});

	it("falls back to the folder name on a server without SPECIAL-USE", () => {
		assert.equal(addressSightingIn({ fullPath: "Spam" }), "junk");
		assert.equal(addressSightingIn({ fullPath: "[Gmail]/Spam" }), "junk");
		assert.equal(addressSightingIn({ fullPath: "Deleted Items" }), "discarded");
	});

	it("harvests every envelope address of an ordinary message", async () => {
		const saved = await save(mailboxAt("INBOX"));

		assert.deepEqual(emails(saved.correspondents), BOTH);
		assert.equal(saved.junk.length, 0);
		assert.equal(saved.neutral.length, 0);
	});

	it("withholds every envelope address of a message in Junk", async () => {
		const saved = await save(mailboxAt("INBOX/Spam", [MailboxSpecialUse.Junk]));

		assert.deepEqual(emails(saved.junk), BOTH);
		assert.equal(saved.correspondents.length, 0);
	});

	it("still records the envelope a message in Junk renders", async () => {
		const saved = await save(mailboxAt("INBOX/Spam", [MailboxSpecialUse.Junk]));

		assert.deepEqual(emails(saved.envelopeAddresses), BOTH);
	});

	it("withholds when Junk is one designation among several", async () => {
		const saved = await save(
			mailboxAt("Archive", [MailboxSpecialUse.Junk, MailboxSpecialUse.Archive]),
		);

		assert.equal(saved.correspondents.length, 0);
		assert.equal(saved.junk.length, 2);
	});

	/**
	 * Deleting spam must not put its sender back in autocomplete, and keeping a
	 * deleted correspondent must not take theirs out.
	 */
	it("keeps a message in Trash from deciding either way", async () => {
		const saved = await save(mailboxAt("Trash", [MailboxSpecialUse.Trash]));

		assert.deepEqual(emails(saved.neutral), BOTH);
		assert.equal(saved.correspondents.length, 0);
		assert.equal(saved.junk.length, 0);
	});

	it("harvests the same message once an ordinary folder holds it", async () => {
		await save(mailboxAt("INBOX/Spam", [MailboxSpecialUse.Junk]));
		const moved = await save(mailboxAt("INBOX"));

		assert.deepEqual(emails(moved.correspondents), BOTH);
	});
});
