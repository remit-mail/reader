/**
 * Harvesting takes the display name straight off the envelope, and a sender
 * chooses that string. A 2021 spam message reached this account's INBOX with
 * `matthijs@ischen.nl <aramirez@secresaludguaviare.gov.co>`: the account's own
 * address as the label on a stranger's. It was stored, autocomplete offered it
 * back when the account holder typed his own address, and a private reply left
 * the instance (issue #826).
 *
 * The name lands in three columns on this one save — the address book, the
 * envelope the message header renders, and the sender label the message list
 * shows and search indexes — so all three are asserted here.
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
	MessageItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { MessageSyncService } from "./message-sync.js";
import type { ImapAddress, ImapEnvelope, ImapMessage } from "./types.js";

const stub = <T>(): T => ({}) as T;

const emptyEnvelope: ImapEnvelope = {
	date: new Date(0).toISOString(),
	messageId: "<root@example.com>",
	subject: "Subject",
	from: [],
	sender: [],
	replyTo: [],
	to: [],
	cc: [],
	bcc: [],
	inReplyTo: "",
};

interface Saved {
	addresses: CreateAddressInput[];
	envelopeAddresses: CreateEnvelopeAddressInput[];
	threadMessages: CreateThreadMessageInput[];
}

/**
 * Drive the real save path so the stored value is the one the write path
 * produces, not one a test handed to a private method.
 */
const harvest = async (envelope: Partial<ImapEnvelope>): Promise<Saved> => {
	const saved: Saved = {
		addresses: [],
		envelopeAddresses: [],
		threadMessages: [],
	};

	const messageService = {
		upsertWithStatus: async (input: unknown) => ({
			item: input as MessageItem,
			created: true,
		}),
	} as unknown as IMessageRepository;

	const threadMessageService = {
		create: async (input: CreateThreadMessageInput) => {
			saved.threadMessages.push(input);
			return input as unknown as ThreadMessageItem;
		},
	} as unknown as IThreadMessageRepository;

	const envelopeService = {
		upsertEnvelope: async () => {},
		upsertBodyParts: async () => {},
	} as unknown as IEnvelopeRepository;

	const addressService = {
		upsertAddress: async (input: CreateAddressInput) => {
			saved.addresses.push(input);
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
		envelope: { ...emptyEnvelope, ...envelope },
	} as unknown as ImapMessage;

	await (
		service as unknown as {
			saveMessage: (
				mailboxId: string,
				accountId: string,
				accountConfigId: string,
				msg: ImapMessage,
			) => Promise<unknown>;
		}
	).saveMessage("mbx-1", "acct-1", "cfg-1", msg);

	return saved;
};

const spoof: ImapAddress = {
	name: "matthijs@ischen.nl",
	mailbox: "aramirez",
	host: "secresaludguaviare.gov.co",
};

const onlyAddress = async (
	envelope: Partial<ImapEnvelope>,
): Promise<CreateAddressInput> => {
	const { addresses } = await harvest(envelope);
	assert.equal(addresses.length, 1);
	const [input] = addresses;
	assert.ok(input);
	return input;
};

describe("harvesting an envelope display name", () => {
	it("drops a name that is an address the row does not own", async () => {
		const input = await onlyAddress({ from: [spoof] });

		assert.equal(input.displayName, "");
		assert.equal(input.normalizedEmail, "aramirez@secresaludguaviare.gov.co");
		assert.equal(
			input.normalizedCompound,
			"aramirez@secresaludguaviare.gov.co",
		);
	});

	/**
	 * The incident with one word prepended. An anchored guard reads this as an
	 * ordinary name and stores it, and autocomplete then ties it with the real
	 * address on the term `matthijs` and breaks the tie on correspondence.
	 */
	it("drops a name that merely carries another address", async () => {
		const input = await onlyAddress({
			from: [{ ...spoof, name: "Matthijs <matthijs@ischen.nl>" }],
		});

		assert.equal(input.displayName, "");
	});

	it("keeps a name that is the address it labels", async () => {
		const input = await onlyAddress({
			from: [
				{
					name: "ING@ing-nl-mailing.nl",
					mailbox: "ing",
					host: "ing-nl-mailing.nl",
				},
			],
		});

		assert.equal(input.displayName, "ING@ing-nl-mailing.nl");
		assert.equal(
			input.normalizedCompound,
			"ing@ing-nl-mailing.nl ing@ing-nl-mailing.nl",
		);
	});

	it("keeps a non-ASCII name that is the address it labels", async () => {
		const input = await onlyAddress({
			from: [
				{ name: "Özcan@example.com", mailbox: "Özcan", host: "example.com" },
			],
		});

		assert.equal(input.displayName, "Özcan@example.com");
	});

	it("keeps an ordinary human name", async () => {
		const input = await onlyAddress({
			from: [
				{ name: "Matthijs van Henten", mailbox: "matthijs", host: "ischen.nl" },
			],
		});

		assert.equal(input.displayName, "Matthijs van Henten");
		assert.equal(
			input.normalizedCompound,
			"matthijs van henten matthijs@ischen.nl",
		);
	});

	it("drops the name on every harvested envelope role", async () => {
		const { addresses } = await harvest({
			from: [spoof],
			sender: [spoof],
			replyTo: [spoof],
			to: [spoof],
			cc: [spoof],
			bcc: [spoof],
		});

		assert.equal(addresses.length, 6);
		for (const input of addresses) {
			assert.equal(input.displayName, "");
		}
	});

	it("still harvests the address from every envelope role", async () => {
		const named = (mailbox: string): ImapAddress[] => [
			{ name: "Someone", mailbox, host: "example.com" },
		];
		const { addresses } = await harvest({
			from: named("from"),
			sender: named("sender"),
			replyTo: named("reply-to"),
			to: named("to"),
			cc: named("cc"),
			bcc: named("bcc"),
		});

		assert.deepEqual(
			addresses.map((input) => input.normalizedEmail),
			[
				"from@example.com",
				"sender@example.com",
				"reply-to@example.com",
				"to@example.com",
				"cc@example.com",
				"bcc@example.com",
			],
		);
		for (const input of addresses) {
			assert.equal(input.displayName, "Someone");
		}
	});

	it("drops the name on the envelope the message header renders", async () => {
		const { envelopeAddresses } = await harvest({ from: [spoof] });

		assert.equal(envelopeAddresses.length, 1);
		assert.equal(envelopeAddresses[0]?.displayName, "");
	});

	it("drops the sender label the message list shows", async () => {
		const { threadMessages } = await harvest({ from: [spoof] });

		assert.equal(threadMessages.length, 1);
		assert.equal(threadMessages[0]?.fromName, undefined);
		assert.equal(
			threadMessages[0]?.fromEmail,
			"aramirez@secresaludguaviare.gov.co",
		);
	});

	it("keeps the sender label when it is an ordinary name", async () => {
		const { threadMessages } = await harvest({
			from: [
				{ name: "Alejandro Ramirez", mailbox: "aramirez", host: "example.gov" },
			],
		});

		assert.equal(threadMessages[0]?.fromName, "Alejandro Ramirez");
	});
});
