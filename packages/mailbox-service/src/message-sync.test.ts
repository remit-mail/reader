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
		upsertWithStatus: async (input: { mailboxId: string }) => ({
			item: { mailboxId: input.mailboxId },
			created: true,
		}),
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

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

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

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		assert.equal(result.syncedCount, 1);
		assert.equal(fake.upsertCalls.length, 0);
	});
});

// ---------------------------------------------------------------------------
// hasAttachment derivation
// ---------------------------------------------------------------------------

const buildFakeServicesWithCreateCapture = () => {
	const createCalls: Array<Record<string, unknown>> = [];

	const mailboxService = {
		get: async () => ({
			fullPath: "INBOX",
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			messageCount: 0,
		}),
		update: async () => undefined,
	} as unknown as import("@remit/remit-electrodb-service").MailboxService;

	const messageService = {
		upsertWithStatus: async (input: { mailboxId: string }) => ({
			item: { mailboxId: input.mailboxId },
			created: true,
		}),
	} as unknown as import("@remit/remit-electrodb-service").MessageService;

	const envelopeService = {
		upsertEnvelope: async () => undefined,
		upsertBodyParts: async () => undefined,
	} as unknown as import("@remit/remit-electrodb-service").EnvelopeService;

	const addressService = {
		upsertAddress: async () => undefined,
		upsertEnvelopeAddress: async () => undefined,
	} as unknown as import("@remit/remit-electrodb-service").AddressService;

	const threadMessageService = {
		create: async (input: Record<string, unknown>) => {
			createCalls.push(input);
			return {};
		},
	} as unknown as import("@remit/remit-electrodb-service").ThreadMessageService;

	return {
		mailboxService,
		messageService,
		envelopeService,
		addressService,
		threadMessageService,
		createCalls,
	};
};

const withAttachmentMessage: ImapMessage = {
	...aliceMessage,
	uid: 43,
	bodyStructure: {
		type: "multipart/mixed",
		parameters: { boundary: "mix" },
		childNodes: [
			{
				part: "1",
				type: "text/plain",
				parameters: { charset: "utf-8" },
				encoding: "7bit",
				size: 50,
			},
			{
				part: "2",
				type: "application/pdf",
				encoding: "base64",
				size: 20480,
				disposition: "attachment",
				dispositionParameters: { filename: "report.pdf" },
			},
		],
	},
};

const inlineImageMessage: ImapMessage = {
	...aliceMessage,
	uid: 44,
	bodyStructure: {
		type: "multipart/related",
		parameters: { boundary: "rel" },
		childNodes: [
			{
				part: "1",
				type: "text/html",
				parameters: { charset: "utf-8" },
				encoding: "quoted-printable",
				size: 300,
			},
			{
				part: "2",
				type: "image/png",
				encoding: "base64",
				size: 8192,
				// inline — should NOT count as an attachment
				disposition: "inline",
				id: "logo@cid",
			},
		],
	},
};

describe("MessageSyncService.syncMessages — hasAttachment derivation", () => {
	const buildService = (msgs: ImapMessage[]) => {
		const fake = buildFakeServicesWithCreateCapture();
		const factory = buildConnectionFactory(msgs);
		const service = new MessageSyncService(
			factory,
			fake.mailboxService,
			fake.messageService,
			fake.envelopeService,
			fake.addressService,
			fake.threadMessageService,
		);
		return { service, fake };
	};

	it("sets hasAttachment: false for a text-only message", async () => {
		const { service, fake } = buildService([aliceMessage]);
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		assert.equal(fake.createCalls.length, 1);
		assert.equal(fake.createCalls[0]!.hasAttachment, false);
	});

	it("sets hasAttachment: true when a non-inline part has disposition=attachment", async () => {
		const { service, fake } = buildService([withAttachmentMessage]);
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		assert.equal(fake.createCalls.length, 1);
		assert.equal(fake.createCalls[0]!.hasAttachment, true);
	});

	it("sets hasAttachment: false when the only non-text part is inline (CID image)", async () => {
		const { service, fake } = buildService([inlineImageMessage]);
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		assert.equal(fake.createCalls.length, 1);
		assert.equal(fake.createCalls[0]!.hasAttachment, false);
	});

	it("sets hasAttachment: false when BODYSTRUCTURE is absent", async () => {
		const { service, fake } = buildService([
			{ ...aliceMessage, uid: 45, bodyStructure: undefined },
		]);
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		assert.equal(fake.createCalls.length, 1);
		assert.equal(fake.createCalls[0]!.hasAttachment, false);
	});
});

// ---------------------------------------------------------------------------
// Watermark advances over all consumed UIDs; body-sync set is owned-only (#634)
// ---------------------------------------------------------------------------

interface UpsertStatusInput {
	messageId: string;
	mailboxId: string;
	uid: number;
}

const buildWatermarkHarness = (opts: {
	lastSyncUid: number;
	highWaterMarkUid: number;
	// Decide the upsert outcome per call. created:true is owned; created:false
	// with a foreign mailboxId is a cross-mailbox conflict — excluded from
	// body-sync (syncedMessageIds) but it still advances the watermark.
	resolveUpsert: (input: UpsertStatusInput) => {
		item: { mailboxId: string };
		created: boolean;
	};
}) => {
	const updateCalls: Array<Record<string, unknown>> = [];
	// Mutable watermark state so multi-cycle tests observe progress: each
	// `update` writes back, and the next `get` (next sync cycle) reads it.
	const state = {
		lastSyncUid: opts.lastSyncUid,
		highWaterMarkUid: opts.highWaterMarkUid,
	};

	const mailboxService = {
		get: async () => ({
			fullPath: "INBOX",
			lastSyncUid: state.lastSyncUid,
			highWaterMarkUid: state.highWaterMarkUid,
			messageCount: 0,
		}),
		update: async (_mailboxId: string, patch: Record<string, unknown>) => {
			updateCalls.push(patch);
			if (typeof patch.lastSyncUid === "number") {
				state.lastSyncUid = patch.lastSyncUid;
			}
			if (typeof patch.highWaterMarkUid === "number") {
				state.highWaterMarkUid = patch.highWaterMarkUid;
			}
		},
	} as unknown as import("@remit/remit-electrodb-service").MailboxService;

	const messageService = {
		upsertWithStatus: async (input: UpsertStatusInput) =>
			opts.resolveUpsert(input),
	} as unknown as import("@remit/remit-electrodb-service").MessageService;

	const envelopeService = {
		upsertEnvelope: async () => undefined,
		upsertBodyParts: async () => undefined,
	} as unknown as import("@remit/remit-electrodb-service").EnvelopeService;

	const addressService = {
		upsertAddress: async () => undefined,
		upsertEnvelopeAddress: async () => undefined,
	} as unknown as import("@remit/remit-electrodb-service").AddressService;

	const threadMessageService = {
		create: async () => ({}),
	} as unknown as import("@remit/remit-electrodb-service").ThreadMessageService;

	return {
		mailboxService,
		messageService,
		envelopeService,
		addressService,
		threadMessageService,
		updateCalls,
	};
};

const messageWithUid = (uid: number, header: string): ImapMessage => ({
	...aliceMessage,
	uid,
	envelope: { ...aliceMessage.envelope!, messageId: header },
	bodyStructure: undefined,
});

describe("MessageSyncService.syncMessages — watermark vs body-sync (#634)", () => {
	it("advances watermarks for created/owned rows", async () => {
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			resolveUpsert: (input) => ({
				item: { mailboxId: input.mailboxId },
				created: true,
			}),
		});
		const factory = buildConnectionFactory([
			messageWithUid(10, "<a@x>"),
			messageWithUid(20, "<b@x>"),
		]);
		const service = new MessageSyncService(
			factory,
			harness.mailboxService,
			harness.messageService,
			harness.envelopeService,
			harness.addressService,
			harness.threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		assert.equal(result.syncedCount, 2);
		const patch = harness.updateCalls.at(-1)!;
		assert.equal(patch.highWaterMarkUid, 20);
		assert.equal(patch.lastSyncUid, 10);
	});

	it("advances the watermark over a foreign-owned conflict but excludes it from body-sync", async () => {
		// Every upsert resolves to an existing row owned by a DIFFERENT mailbox.
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			resolveUpsert: () => ({
				item: { mailboxId: "other-mailbox" },
				created: false,
			}),
		});
		const factory = buildConnectionFactory([
			messageWithUid(10, "<a@x>"),
			messageWithUid(20, "<b@x>"),
		]);
		const service = new MessageSyncService(
			factory,
			harness.mailboxService,
			harness.messageService,
			harness.envelopeService,
			harness.addressService,
			harness.threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		// Foreign-owned rows are excluded from syncedMessageIds (no body-sync)...
		assert.equal(result.syncedCount, 0);
		assert.deepEqual(result.syncedMessageIds, []);

		// ...but the watermarks still advance over the consumed UIDs so the batch
		// is not re-fetched forever (liveness).
		const patch = harness.updateCalls.at(-1)!;
		assert.equal(patch.highWaterMarkUid, 20);
		assert.equal(patch.lastSyncUid, 10);
	});

	it("advances over all consumed UIDs while body-sync stays owned-only (mixed batch)", async () => {
		// uid 10 is ours (created), uid 20 is a foreign conflict.
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			resolveUpsert: (input) =>
				input.uid === 10
					? { item: { mailboxId: input.mailboxId }, created: true }
					: { item: { mailboxId: "other-mailbox" }, created: false },
		});
		const factory = buildConnectionFactory([
			messageWithUid(10, "<a@x>"),
			messageWithUid(20, "<b@x>"),
		]);
		const service = new MessageSyncService(
			factory,
			harness.mailboxService,
			harness.messageService,
			harness.envelopeService,
			harness.addressService,
			harness.threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		// Only the owned uid 10 enters body-sync...
		assert.equal(result.syncedCount, 1);
		assert.equal(result.syncedMessages[0]!.uid, 10);
		// ...while the watermarks advance over BOTH consumed UIDs.
		const patch = harness.updateCalls.at(-1)!;
		assert.equal(patch.highWaterMarkUid, 20);
		assert.equal(patch.lastSyncUid, 10);
	});

	it("does not stall forward sync across cycles when the highest UID is foreign-owned", async () => {
		// The highest UID (20) is a foreign-owned conflict — the common case where
		// the newest mail lands in Gmail All Mail first, then surfaces in another
		// synced mailbox. The watermark must clear it so the next cycle's
		// fetchUidsToSync does not reselect it.
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			resolveUpsert: (input) =>
				input.uid === 20
					? { item: { mailboxId: "other-mailbox" }, created: false }
					: { item: { mailboxId: input.mailboxId }, created: true },
		});

		const allMsgs = [messageWithUid(10, "<a@x>"), messageWithUid(20, "<b@x>")];
		const fetchedPerCycle: number[][] = [];
		const factory = {
			getConnection: () => ({
				openBox: async () => ({
					uidvalidity: 1,
					uidnext: 21,
					messageCount: allMsgs.length,
				}),
				getMailboxStatus: async () => ({ unseen: 0 }),
				search: async () => allMsgs.map((m) => m.uid),
				fetchMessages: async (uids: number[]) => {
					fetchedPerCycle.push(uids);
					return allMsgs.filter((m) => uids.includes(m.uid));
				},
			}),
		} as unknown as ManagedConnectionFactory;

		const service = new MessageSyncService(
			factory,
			harness.mailboxService,
			harness.messageService,
			harness.envelopeService,
			harness.addressService,
			harness.threadMessageService,
		);

		// Cycle 1: both UIDs are fresh; watermark advances to 20.
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		assert.deepEqual(
			[...fetchedPerCycle[0]!].sort((a, b) => a - b),
			[10, 20],
		);

		// Cycle 2: nothing above the watermark (20) remains — the foreign-owned
		// UID 20 is NOT re-fetched, so forward sync does not stall.
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		assert.equal(fetchedPerCycle.length, 1);
	});

	it("treats a same-mailbox conflict (re-sync) as owned", async () => {
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			// Conflict, but the stored row belongs to THIS mailbox.
			resolveUpsert: () => ({ item: { mailboxId: "mbx-1" }, created: false }),
		});
		const factory = buildConnectionFactory([messageWithUid(15, "<a@x>")]);
		const service = new MessageSyncService(
			factory,
			harness.mailboxService,
			harness.messageService,
			harness.envelopeService,
			harness.addressService,
			harness.threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		assert.equal(result.syncedCount, 1);
		const patch = harness.updateCalls.at(-1)!;
		assert.equal(patch.highWaterMarkUid, 15);
		assert.equal(patch.lastSyncUid, 15);
	});
});
