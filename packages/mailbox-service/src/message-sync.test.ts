import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AddressService,
	BodyPartUpsertInput,
	EnvelopeService,
	MailboxService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { MessageSyncService } from "./message-sync.js";
import type { ImapMessage } from "./types.js";

interface UpsertCall {
	messageId: string;
	parts: BodyPartUpsertInput[];
}

const buildFakeServices = () => {
	const upsertCalls: UpsertCall[] = [];

	// Mailbox returns the existing high-watermark so the only path that
	// fires is the "no new messages" branch, which is fine — we drive the
	// sync via `saveMessage` directly through the public batch entrypoint.
	const mailboxService = {
		get: async () => ({
			fullPath: "INBOX",
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			messageCount: 0,
		}),
		update: async () => undefined,
	} as unknown as MailboxService;

	const messageService = {
		upsert: async () => undefined,
	} as unknown as MessageService;

	const envelopeService = {
		upsertEnvelope: async () => undefined,
		upsertBodyParts: async (
			messageId: string,
			parts: BodyPartUpsertInput[],
		) => {
			upsertCalls.push({ messageId, parts });
		},
	} as unknown as EnvelopeService;

	const addressService = {
		upsertAddress: async () => undefined,
		upsertEnvelopeAddress: async () => undefined,
	} as unknown as AddressService;

	const threadMessageService = {
		create: async () => ({}),
	} as unknown as ThreadMessageService;

	return {
		mailboxService,
		messageService,
		envelopeService,
		addressService,
		threadMessageService,
		upsertCalls,
	};
};

const buildConnectionFactory = (
	msgs: ImapMessage[],
): ManagedConnectionFactory => {
	const conn = {
		openBox: async () => ({
			uidvalidity: 1,
			uidnext: msgs.length + 1,
			messageCount: msgs.length,
		}),
		getMailboxStatus: async () => ({ unseen: 0 }),
		search: async () => msgs.map((m) => m.uid),
		fetchMessages: async () => msgs,
	};
	return {
		getConnection: () => conn,
	} as unknown as ManagedConnectionFactory;
};

const aliceMessage: ImapMessage = {
	uid: 42,
	seq: 1,
	flags: ["\\Seen"],
	internalDate: new Date("2026-04-28T12:00:00Z"),
	size: 1234,
	envelope: {
		date: "2026-04-28T12:00:00.000Z",
		subject: "alice -> bob",
		from: [{ name: "Alice", mailbox: "alice", host: "example.com" }],
		sender: [],
		replyTo: [],
		to: [{ name: "Bob", mailbox: "bob", host: "example.com" }],
		cc: [],
		bcc: [],
		inReplyTo: "",
		messageId: "<alice-1@example.com>",
	},
	references: undefined,
	bodyStructure: {
		type: "multipart/alternative",
		parameters: { boundary: "alt" },
		childNodes: [
			{
				part: "1",
				type: "text/plain",
				parameters: { charset: "utf-8" },
				encoding: "7bit",
				size: 120,
				lineCount: 4,
			},
			{
				part: "2",
				type: "text/html",
				parameters: { charset: "utf-8" },
				encoding: "quoted-printable",
				size: 350,
				lineCount: 6,
			},
		],
	},
};

describe("MessageSyncService.syncMessages — BodyPart persistence", () => {
	it("walks BODYSTRUCTURE and calls envelopeService.upsertBodyParts for each message", async () => {
		const fake = buildFakeServices();
		const factory = buildConnectionFactory([aliceMessage]);

		const service = new MessageSyncService(
			factory,
			fake.mailboxService,
			fake.messageService,
			fake.envelopeService,
			fake.addressService,
			fake.threadMessageService,
		);

		const result = await service.syncMessages("mbx-1", "acc-cfg-1", 50);

		assert.equal(result.syncedCount, 1);
		assert.equal(fake.upsertCalls.length, 1);

		const [call] = fake.upsertCalls;
		assert.equal(call.parts.length, 3);

		const root = call.parts.find((p) => p.partPath === "0");
		assert.ok(root);
		assert.equal(root.isMultipart, true);
		assert.equal(root.multipartSubtype, "alternative");
		assert.equal(root.parentPartPath, null);

		const text = call.parts.find((p) => p.partPath === "1");
		assert.ok(text);
		assert.equal(text.mediaType, "TEXT");
		assert.equal(text.mediaSubtype, "plain");
		assert.equal(text.parentPartPath, "0");
		assert.equal(text.transferEncoding, "7BIT");
		assert.equal(text.sizeOctets, 120);

		const html = call.parts.find((p) => p.partPath === "2");
		assert.ok(html);
		assert.equal(html.transferEncoding, "QUOTED-PRINTABLE");
	});

	it("skips upsertBodyParts when the IMAP server didn't return BODYSTRUCTURE", async () => {
		const fake = buildFakeServices();
		const noStructureMessage: ImapMessage = {
			...aliceMessage,
			bodyStructure: undefined,
		};
		const factory = buildConnectionFactory([noStructureMessage]);

		const service = new MessageSyncService(
			factory,
			fake.mailboxService,
			fake.messageService,
			fake.envelopeService,
			fake.addressService,
			fake.threadMessageService,
		);

		const result = await service.syncMessages("mbx-1", "acc-cfg-1", 50);

		assert.equal(result.syncedCount, 1);
		assert.equal(fake.upsertCalls.length, 0);
	});
});
