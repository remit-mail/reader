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
import type { ManagedConnectionFactory } from "./connection-factory.js";
import {
	type AccountFolderRoles,
	addressSightingIn,
	MessageSyncService,
} from "./message-sync.js";
import { folderRoles } from "./test-helpers/folder-roles.js";
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
	reconciled: string[];
	withheld: string[];
}

const mailboxAt = (fullPath: string): MailboxItem =>
	({
		mailboxId: `mbx-${fullPath}`,
		fullPath,
		hierarchyDelimiter: "/",
	}) as MailboxItem;

/**
 * Save one message into `mailbox`, with the account holding `role` in that same
 * folder. `undefined` is an account whose Junk and Trash are elsewhere.
 */
const save = async (
	mailbox: MailboxItem,
	role?: "Junk" | "Trash",
): Promise<Saved> => {
	const saved: Saved = {
		correspondents: [],
		junk: [],
		neutral: [],
		envelopeAddresses: [],
		reconciled: [],
		withheld: [],
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
		reconcileJunkOnlyForMessage: async (messageId: string) => {
			saved.reconciled.push(messageId);
		},
		withholdAddressesSeenInJunk: async (messageId: string) => {
			saved.withheld.push(messageId);
		},
	} as unknown as IAddressRepository;

	const service = new MessageSyncService(
		stub<ManagedConnectionFactory>(),
		stub<IMailboxRepository>(),
		folderRoles(
			role === "Junk"
				? { junkMailboxId: mailbox.mailboxId }
				: role === "Trash"
					? { trashMailboxId: mailbox.mailboxId }
					: {},
		),
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
				roles: AccountFolderRoles,
			) => Promise<unknown>;
		}
	).saveMessage(mailbox, "acct-1", "cfg-1", msg, {
		junkMailboxId: role === "Junk" ? mailbox.mailboxId : null,
		trashMailboxId: role === "Trash" ? mailbox.mailboxId : null,
	});

	return saved;
};

const emails = (inputs: Array<{ normalizedEmail: string }>): string[] =>
	inputs.map((input) => input.normalizedEmail);

const BOTH = ["sales@pharma.example", "victim@ischen.nl"];

describe("what a mailbox says about the addresses on its messages", () => {
	const ROLES = (junk: string | null, trash: string | null) => ({
		junkMailboxId: junk,
		trashMailboxId: trash,
	});

	it("reads the folder the account appointed, not the folder’s name", () => {
		// The account appointed `INBOX/Rubbish` as Junk. A second folder called
		// `Spam` is an ordinary folder, and its senders are correspondents —
		// a role belongs to one folder (RFC 032), so a name cannot claim it.
		const roles = ROLES("mbx-rubbish", null);
		assert.equal(addressSightingIn("mbx-rubbish", roles), "junk");
		assert.equal(addressSightingIn("mbx-spam", roles), "correspondent");
	});

	it("keeps a message in Trash from deciding either way", () => {
		assert.equal(
			addressSightingIn("mbx-trash", ROLES(null, "mbx-trash")),
			"discarded",
		);
	});

	it("reads an account with neither role as all correspondents", () => {
		assert.equal(
			addressSightingIn("mbx-anything", ROLES(null, null)),
			"correspondent",
		);
	});

	it("harvests every envelope address of an ordinary message", async () => {
		const saved = await save(mailboxAt("INBOX"));

		assert.deepEqual(emails(saved.correspondents), BOTH);
		assert.equal(saved.junk.length, 0);
		assert.equal(saved.neutral.length, 0);
	});

	it("withholds every envelope address of a message in Junk", async () => {
		const saved = await save(mailboxAt("INBOX/Rubbish"), "Junk");

		assert.deepEqual(emails(saved.junk), BOTH);
		assert.equal(saved.correspondents.length, 0);
	});

	it("still records the envelope a message in Junk renders", async () => {
		const saved = await save(mailboxAt("INBOX/Rubbish"), "Junk");

		assert.deepEqual(emails(saved.envelopeAddresses), BOTH);
	});

	it("keeps a message in Trash from deciding either way", async () => {
		const saved = await save(mailboxAt("Trash"), "Trash");

		assert.deepEqual(emails(saved.neutral), BOTH);
		assert.equal(saved.correspondents.length, 0);
		assert.equal(saved.junk.length, 0);
	});

	it("withholds every sender a message in Junk carries", async () => {
		const saved = await save(mailboxAt("INBOX/Rubbish"), "Junk");

		assert.equal(saved.withheld.length, 1);
		assert.deepEqual(saved.withheld, [saved.envelopeAddresses[0].messageId]);
		assert.deepEqual(saved.reconciled, []);
	});

	it("asks nothing of a sender met on live mail", async () => {
		const inbox = await save(mailboxAt("INBOX"));
		const trash = await save(mailboxAt("Trash"), "Trash");

		assert.deepEqual(inbox.withheld, []);
		assert.deepEqual(trash.withheld, []);
	});

	it("harvests the same message once an ordinary folder holds it", async () => {
		await save(mailboxAt("INBOX/Rubbish"), "Junk");
		const moved = await save(mailboxAt("INBOX"));

		assert.deepEqual(emails(moved.correspondents), BOTH);
	});
});
