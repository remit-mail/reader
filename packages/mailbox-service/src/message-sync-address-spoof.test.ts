/**
 * Harvesting takes the display name straight off the envelope, and a sender
 * chooses that string. A 2021 spam message reached this account's INBOX with
 * `matthijs@ischen.nl <aramirez@secresaludguaviare.gov.co>`: the account's own
 * address as the label on a stranger's. It was stored, autocomplete offered it
 * back when the account holder typed his own address, and a private reply left
 * the instance (issue #826).
 *
 * The address is verifiable and is kept. The name is not, so an email-shaped
 * name that is not the address it labels is stored empty.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	CreateAddressInput,
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

/**
 * Drive the real save path so the stored value is the one the write path
 * produces, not one a test handed to a private method.
 */
const harvest = async (
	envelope: Partial<ImapEnvelope>,
): Promise<CreateAddressInput[]> => {
	const stored: CreateAddressInput[] = [];

	const messageService = {
		upsertWithStatus: async (input: unknown) => ({
			item: input as MessageItem,
			created: true,
		}),
	} as unknown as IMessageRepository;

	const threadMessageService = {
		create: async (input: unknown) => input as ThreadMessageItem,
	} as unknown as IThreadMessageRepository;

	const envelopeService = {
		upsertEnvelope: async () => {},
		upsertBodyParts: async () => {},
	} as unknown as IEnvelopeRepository;

	const addressService = {
		upsertAddress: async (input: CreateAddressInput) => {
			stored.push(input);
		},
		upsertEnvelopeAddress: async () => {},
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

	return stored;
};

const spoof: ImapAddress = {
	name: "matthijs@ischen.nl",
	mailbox: "aramirez",
	host: "secresaludguaviare.gov.co",
};

const only = async (
	envelope: Partial<ImapEnvelope>,
): Promise<CreateAddressInput> => {
	const stored = await harvest(envelope);
	assert.equal(stored.length, 1);
	const [input] = stored;
	assert.ok(input);
	return input;
};

describe("harvesting an envelope display name", () => {
	it("drops a name that is an address the row does not own", async () => {
		const input = await only({ from: [spoof] });

		assert.equal(input.displayName, "");
		assert.equal(input.normalizedEmail, "aramirez@secresaludguaviare.gov.co");
		assert.equal(
			input.normalizedCompound,
			"aramirez@secresaludguaviare.gov.co",
		);
	});

	it("keeps a name that is the address it labels", async () => {
		const input = await only({
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

	it("keeps an ordinary human name", async () => {
		const input = await only({
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
		const stored = await harvest({
			from: [spoof],
			sender: [spoof],
			replyTo: [spoof],
			to: [spoof],
			cc: [spoof],
			bcc: [spoof],
		});

		assert.equal(stored.length, 6);
		for (const input of stored) {
			assert.equal(input.displayName, "");
		}
	});

	it("still harvests the address from every envelope role", async () => {
		const named = (mailbox: string): ImapAddress[] => [
			{ name: "Someone", mailbox, host: "example.com" },
		];
		const stored = await harvest({
			from: named("from"),
			sender: named("sender"),
			replyTo: named("reply-to"),
			to: named("to"),
			cc: named("cc"),
			bcc: named("bcc"),
		});

		assert.deepEqual(
			stored.map((input) => input.normalizedEmail),
			[
				"from@example.com",
				"sender@example.com",
				"reply-to@example.com",
				"to@example.com",
				"cc@example.com",
				"bcc@example.com",
			],
		);
		for (const input of stored) {
			assert.equal(input.displayName, "Someone");
		}
	});
});
