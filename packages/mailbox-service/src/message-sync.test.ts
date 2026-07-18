import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailboxCursorState } from "@remit/domain-enums";
import type {
	AddressService,
	BodyPartUpsertInput,
	EnvelopeService,
	MailboxService,
} from "@remit/remit-electrodb-service";
import {
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import {
	isParseableEmailAddress,
	MessageSyncService,
	parseHeaderDate,
} from "./message-sync.js";
import type { ImapAddress, ImapEnvelope, ImapMessage } from "./types.js";

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
			uidValidity: 1,
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
	deletedCount = 0,
): ManagedConnectionFactory => {
	const conn = {
		openBox: async () => ({
			uidvalidity: 1,
			uidnext: msgs.length + 1,
			messageCount: msgs.length,
		}),
		getMailboxStatus: async () => ({ unseen: 0, deletedCount }),
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
			uidValidity: 1,
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
		assert.equal(fake.createCalls[0]?.hasAttachment, false);
	});

	it("sets hasAttachment: true when a non-inline part has disposition=attachment", async () => {
		const { service, fake } = buildService([withAttachmentMessage]);
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		assert.equal(fake.createCalls.length, 1);
		assert.equal(fake.createCalls[0]?.hasAttachment, true);
	});

	it("sets hasAttachment: false when the only non-text part is inline (CID image)", async () => {
		const { service, fake } = buildService([inlineImageMessage]);
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		assert.equal(fake.createCalls.length, 1);
		assert.equal(fake.createCalls[0]?.hasAttachment, false);
	});

	it("sets hasAttachment: false when BODYSTRUCTURE is absent", async () => {
		const { service, fake } = buildService([
			{ ...aliceMessage, uid: 45, bodyStructure: undefined },
		]);
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		assert.equal(fake.createCalls.length, 1);
		assert.equal(fake.createCalls[0]?.hasAttachment, false);
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
			uidValidity: 1,
			lastSyncUid: state.lastSyncUid,
			highWaterMarkUid: state.highWaterMarkUid,
			messageCount: 0,
		}),
		update: async (
			_accountId: string,
			_mailboxId: string,
			patch: Record<string, unknown>,
		) => {
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
	// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
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
		// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
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
		// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
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
		assert.equal(result.syncedMessages[0]?.uid, 10);
		// ...while the watermarks advance over BOTH consumed UIDs.
		// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
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
				getMailboxStatus: async () => ({ unseen: 0, deletedCount: 0 }),
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
			// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
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
		// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
		const patch = harness.updateCalls.at(-1)!;
		assert.equal(patch.highWaterMarkUid, 15);
		assert.equal(patch.lastSyncUid, 15);
	});
});

// ---------------------------------------------------------------------------
// deletedCount projection (#1042)
// ---------------------------------------------------------------------------

describe("MessageSyncService.syncMessages — deletedCount projection (#1042)", () => {
	it("persists deletedCount on the no-new-messages path", async () => {
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			resolveUpsert: (input) => ({
				item: { mailboxId: input.mailboxId },
				created: true,
			}),
		});
		const factory = buildConnectionFactory([], 5);
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

		assert.equal(result.syncedCount, 0);
		const patch = harness.updateCalls.at(-1)!;
		assert.equal(patch.deletedCount, 5);
	});

	it("persists deletedCount on the normal sync path", async () => {
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			resolveUpsert: (input) => ({
				item: { mailboxId: input.mailboxId },
				created: true,
			}),
		});
		const factory = buildConnectionFactory([messageWithUid(10, "<a@x>")], 3);
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
		assert.equal(patch.deletedCount, 3);
	});
});

// ---------------------------------------------------------------------------
// parseHeaderDate — guarding the external Date header (#817)
// ---------------------------------------------------------------------------

describe("parseHeaderDate", () => {
	const fallback = 1_700_000_000_000;

	it("parses a valid RFC 2822 date", () => {
		const out = parseHeaderDate("Tue, 28 Apr 2026 12:00:00 +0000", fallback);
		assert.equal(out.usedFallback, false);
		assert.equal(out.value, Date.parse("Tue, 28 Apr 2026 12:00:00 +0000"));
		assert.ok(Number.isInteger(out.value));
	});

	it("parses an ISO date", () => {
		const out = parseHeaderDate("2026-04-28T12:00:00.000Z", fallback);
		assert.equal(out.usedFallback, false);
		assert.equal(out.value, Date.parse("2026-04-28T12:00:00.000Z"));
	});

	it("falls back when the header is undefined", () => {
		const out = parseHeaderDate(undefined, fallback);
		assert.equal(out.usedFallback, true);
		assert.equal(out.value, fallback);
		assert.ok(Number.isInteger(out.value));
	});

	it("falls back when the header is an empty string", () => {
		const out = parseHeaderDate("", fallback);
		assert.equal(out.usedFallback, true);
		assert.equal(out.value, fallback);
	});

	it("falls back on a garbage string", () => {
		const out = parseHeaderDate("not a date at all", fallback);
		assert.equal(out.usedFallback, true);
		assert.equal(out.value, fallback);
		assert.ok(Number.isInteger(out.value));
	});

	it("falls back on a non-Latin / odd format", () => {
		const out = parseHeaderDate("二〇二六年四月二十八日", fallback);
		assert.equal(out.usedFallback, true);
		assert.equal(out.value, fallback);
		assert.ok(Number.isInteger(out.value));
	});
});

// ---------------------------------------------------------------------------
// Bad Date header never poisons the envelope upsert (#817)
// ---------------------------------------------------------------------------

describe("MessageSyncService.saveMessage — unparseable Date header (#817)", () => {
	const buildDateCaptureHarness = () => {
		const envelopeCalls: Array<Record<string, unknown>> = [];
		const warnings: Array<Record<string, unknown>> = [];

		const mailboxService = {
			get: async () => ({
				fullPath: "INBOX",
				uidValidity: 1,
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
			upsertEnvelope: async (input: Record<string, unknown>) => {
				envelopeCalls.push(input);
			},
			upsertBodyParts: async () => undefined,
		} as unknown as EnvelopeService;

		const addressService = {
			upsertAddress: async () => undefined,
			upsertEnvelopeAddress: async () => undefined,
		} as unknown as AddressService;

		const threadMessageService = {
			create: async () => ({}),
		} as unknown as ThreadMessageService;

		const logger = {
			info: () => {},
			warn: (obj: Record<string, unknown>) => {
				warnings.push(obj);
			},
		};

		return {
			mailboxService,
			messageService,
			envelopeService,
			addressService,
			threadMessageService,
			logger,
			envelopeCalls,
			warnings,
		};
	};

	it("falls back to internalDate and preserves dateRaw on a garbage header", async () => {
		const harness = buildDateCaptureHarness();
		const internalDate = new Date("2026-05-01T09:30:00Z");
		const badMessage: ImapMessage = {
			...aliceMessage,
			uid: 99,
			internalDate,
			// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
			envelope: { ...aliceMessage.envelope!, date: "totally-not-a-date" },
			bodyStructure: undefined,
		};
		const factory = buildConnectionFactory([badMessage]);

		const service = new MessageSyncService(
			factory,
			harness.mailboxService,
			harness.messageService,
			harness.envelopeService,
			harness.addressService,
			harness.threadMessageService,
			harness.logger,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		assert.equal(result.syncedCount, 1);
		const [envelope] = harness.envelopeCalls;
		assert.ok(envelope);
		assert.equal(envelope.dateValue, internalDate.getTime());
		assert.ok(Number.isInteger(envelope.dateValue));
		assert.equal(envelope.dateRaw, "totally-not-a-date");

		// The bad header is surfaced at warn level for observability.
		assert.ok(harness.warnings.some((w) => w.dateRaw === "totally-not-a-date"));
	});

	it("keeps a valid header date and does not warn", async () => {
		const harness = buildDateCaptureHarness();
		const goodMessage: ImapMessage = {
			...aliceMessage,
			uid: 100,
			envelope: {
				// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
				...aliceMessage.envelope!,
				date: "2026-04-28T12:00:00.000Z",
			},
			bodyStructure: undefined,
		};
		const factory = buildConnectionFactory([goodMessage]);

		const service = new MessageSyncService(
			factory,
			harness.mailboxService,
			harness.messageService,
			harness.envelopeService,
			harness.addressService,
			harness.threadMessageService,
			harness.logger,
		);

		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);

		const [envelope] = harness.envelopeCalls;
		assert.ok(envelope);
		assert.equal(envelope.dateValue, Date.parse("2026-04-28T12:00:00.000Z"));
		assert.equal(harness.warnings.length, 0);
	});
});

// ---------------------------------------------------------------------------
// One failing message must not abort the batch or freeze the watermark (#817)
// ---------------------------------------------------------------------------

describe("MessageSyncService.syncMessages — batch resilience (#817)", () => {
	it("a single throwing message does not abort the rest of the batch", async () => {
		// uid 20 throws on save; uids 10 and 30 must still be saved.
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			resolveUpsert: (input) => {
				if (input.uid === 20) throw new Error("poison");
				return { item: { mailboxId: input.mailboxId }, created: true };
			},
		});
		const factory = buildConnectionFactory([
			messageWithUid(10, "<a@x>"),
			messageWithUid(20, "<b@x>"),
			messageWithUid(30, "<c@x>"),
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

		// The two healthy messages synced despite uid 20 throwing.
		assert.equal(result.syncedCount, 2);
		assert.deepEqual(
			[...result.syncedMessages.map((m) => m.uid)].sort((a, b) => a - b),
			[10, 30],
		);
	});

	it("holds the watermark below a failed UID so it is retried next cycle", async () => {
		// uid 20 is the highest in the batch and fails; the high watermark must
		// NOT advance past it, so the next cycle re-fetches it (no silent loss).
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			resolveUpsert: (input) => {
				if (input.uid === 20) throw new Error("poison");
				return { item: { mailboxId: input.mailboxId }, created: true };
			},
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

		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);

		// Forward watermark stops below the failed uid 20 (top contiguous success
		// run is empty), so it stays selectable as a "new" UID next cycle.
		// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
		const patch = harness.updateCalls.at(-1)!;
		assert.equal(patch.highWaterMarkUid, 0);
	});

	it("advances the watermark over the top contiguous run of successes", async () => {
		// Only the lowest uid (10) fails; uids 20 and 30 are the top contiguous
		// success run, so the high watermark advances to 30. Backfill stays put
		// because the lowest uid failed.
		const harness = buildWatermarkHarness({
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			resolveUpsert: (input) => {
				if (input.uid === 10) throw new Error("poison");
				return { item: { mailboxId: input.mailboxId }, created: true };
			},
		});
		const factory = buildConnectionFactory([
			messageWithUid(10, "<a@x>"),
			messageWithUid(20, "<b@x>"),
			messageWithUid(30, "<c@x>"),
		]);
		const service = new MessageSyncService(
			factory,
			harness.mailboxService,
			harness.messageService,
			harness.envelopeService,
			harness.addressService,
			harness.threadMessageService,
		);

		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);

		// biome-ignore lint/style/noNonNullAssertion: test assertion, value is guaranteed by test setup
		const patch = harness.updateCalls.at(-1)!;
		assert.equal(patch.highWaterMarkUid, 30);
		// Lowest uid failed → backfill watermark must not move past it.
		assert.equal(patch.lastSyncUid, 0);
	});
});

// ---------------------------------------------------------------------------
// ThreadMessage is written last: a failure never strands a ThreadMessage
// pointing at a missing Message, which the list path would surface (#1072)
// ---------------------------------------------------------------------------

describe("MessageSyncService.saveMessage — ThreadMessage written last (#1072)", () => {
	it("does not write the Message when the Envelope write fails", async () => {
		const order: string[] = [];
		let messageUpserts = 0;

		const mailboxService = {
			get: async () => ({
				fullPath: "INBOX",
				uidValidity: 1,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				messageCount: 0,
			}),
			update: async () => undefined,
		} as unknown as MailboxService;

		const messageService = {
			upsertWithStatus: async (input: { mailboxId: string }) => {
				messageUpserts++;
				order.push("message");
				return { item: { mailboxId: input.mailboxId }, created: true };
			},
		} as unknown as MessageService;

		const envelopeService = {
			upsertEnvelope: async () => {
				order.push("envelope");
				throw new Error("Failed to create Envelope");
			},
			upsertBodyParts: async () => undefined,
		} as unknown as EnvelopeService;

		const addressService = {
			upsertAddress: async () => undefined,
			upsertEnvelopeAddress: async () => undefined,
		} as unknown as AddressService;

		const threadMessageService = {
			create: async () => ({}),
		} as unknown as ThreadMessageService;

		const factory = buildConnectionFactory([messageWithUid(10, "<a@x>")]);
		const service = new MessageSyncService(
			factory,
			mailboxService,
			messageService,
			envelopeService,
			addressService,
			threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		// The Envelope failure rejects the whole save, so no Message row is
		// created — the message is retried whole on the next sync.
		assert.equal(result.syncedCount, 0);
		assert.equal(messageUpserts, 0);
		assert.equal(order.includes("message"), false);
	});

	it("writes the ThreadMessage last, after the Message and its prerequisites", async () => {
		const order: string[] = [];

		const mailboxService = {
			get: async () => ({
				fullPath: "INBOX",
				uidValidity: 1,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				messageCount: 0,
			}),
			update: async () => undefined,
		} as unknown as MailboxService;

		const messageService = {
			upsertWithStatus: async (input: { mailboxId: string }) => {
				order.push("message");
				return { item: { mailboxId: input.mailboxId }, created: true };
			},
		} as unknown as MessageService;

		const envelopeService = {
			upsertEnvelope: async () => {
				order.push("envelope");
			},
			upsertBodyParts: async () => {
				order.push("bodyParts");
			},
		} as unknown as EnvelopeService;

		const addressService = {
			upsertAddress: async () => {
				order.push("address");
			},
			upsertEnvelopeAddress: async () => undefined,
		} as unknown as AddressService;

		const threadMessageService = {
			create: async () => {
				order.push("thread");
				return {};
			},
		} as unknown as ThreadMessageService;

		const factory = buildConnectionFactory([aliceMessage]);
		const service = new MessageSyncService(
			factory,
			mailboxService,
			messageService,
			envelopeService,
			addressService,
			threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		assert.equal(result.syncedCount, 1);
		// Invariant ThreadMessage ⟹ Message ⟹ Envelope: the ThreadMessage is
		// written last, and the Message before it.
		assert.equal(order.at(-1), "thread");
		assert.equal(order.filter((o) => o === "thread").length, 1);
		assert.ok(order.indexOf("message") < order.indexOf("thread"));
	});

	it("does not write the ThreadMessage when the Message upsert fails", async () => {
		const order: string[] = [];
		let threadCreates = 0;

		const mailboxService = {
			get: async () => ({
				fullPath: "INBOX",
				uidValidity: 1,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				messageCount: 0,
			}),
			update: async () => undefined,
		} as unknown as MailboxService;

		const messageService = {
			upsertWithStatus: async () => {
				order.push("message");
				throw new Error("Failed to upsert Message");
			},
		} as unknown as MessageService;

		const envelopeService = {
			upsertEnvelope: async () => {
				order.push("envelope");
			},
			upsertBodyParts: async () => {
				order.push("bodyParts");
			},
		} as unknown as EnvelopeService;

		const addressService = {
			upsertAddress: async () => {
				order.push("address");
			},
			upsertEnvelopeAddress: async () => undefined,
		} as unknown as AddressService;

		const threadMessageService = {
			create: async () => {
				threadCreates++;
				order.push("thread");
				return {};
			},
		} as unknown as ThreadMessageService;

		const factory = buildConnectionFactory([aliceMessage]);
		const service = new MessageSyncService(
			factory,
			mailboxService,
			messageService,
			envelopeService,
			addressService,
			threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		// The Message upsert rejection propagates out of saveMessage before the
		// ThreadMessage write, so no ThreadMessage is created — the message is
		// held for retry on the next sync.
		assert.equal(result.syncedCount, 0);
		assert.equal(threadCreates, 0);
		assert.equal(order.includes("thread"), false);
	});
});

describe("isParseableEmailAddress", () => {
	it("accepts a normal address with a real domain", () => {
		assert.equal(
			isParseableEmailAddress({ mailbox: "alice", host: "example.com" }),
			true,
		);
	});

	it("rejects the Hostnet missing_mailbox/missing_domain sentinels", () => {
		assert.equal(
			isParseableEmailAddress({
				mailbox: "missing_mailbox",
				host: "missing_domain",
			}),
			false,
		);
	});

	it("rejects the sentinel mailbox even with a real host", () => {
		assert.equal(
			isParseableEmailAddress({
				mailbox: "missing_mailbox",
				host: "example.com",
			}),
			false,
		);
	});

	it("rejects a host with no dot (no real domain)", () => {
		assert.equal(
			isParseableEmailAddress({ mailbox: "alice", host: "localhost" }),
			false,
		);
	});

	it("rejects empty mailbox or host", () => {
		assert.equal(
			isParseableEmailAddress({ mailbox: "", host: "x.com" }),
			false,
		);
		assert.equal(isParseableEmailAddress({ mailbox: "a", host: "" }), false);
	});

	it("rejects an undefined address", () => {
		assert.equal(isParseableEmailAddress(undefined), false);
	});
});

describe("MessageSyncService.syncMessages — unparseable sender handling", () => {
	const buildSenderHarness = () => {
		const createCalls: Array<{ fromEmail?: string; fromName?: string }> = [];
		const addressCalls: Array<{ localPart: string; domain: string }> = [];
		const fake = buildFakeServices();
		const threadMessageService = {
			create: async (input: { fromEmail?: string; fromName?: string }) => {
				createCalls.push(input);
				return {};
			},
		} as unknown as ThreadMessageService;
		const addressService = {
			upsertAddress: async (input: { localPart: string; domain: string }) => {
				addressCalls.push(input);
			},
			upsertEnvelopeAddress: async () => undefined,
		} as unknown as AddressService;
		return {
			...fake,
			threadMessageService,
			addressService,
			createCalls,
			addressCalls,
		};
	};

	const runWith = async (from: ImapAddress[]) => {
		const harness = buildSenderHarness();
		const baseEnvelope = aliceMessage.envelope;
		if (!baseEnvelope) throw new Error("fixture missing envelope");
		const message: ImapMessage = {
			...aliceMessage,
			envelope: { ...baseEnvelope, from },
		};
		const factory = buildConnectionFactory([message]);
		const service = new MessageSyncService(
			factory,
			harness.mailboxService,
			harness.messageService,
			harness.envelopeService,
			harness.addressService,
			harness.threadMessageService,
		);
		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);
		return harness;
	};

	it("omits fromEmail and skips the address record for a Hostnet placeholder, keeping fromName", async () => {
		const harness = await runWith([
			{
				name: "Broken Sender",
				mailbox: "missing_mailbox",
				host: "missing_domain",
			},
		]);

		assert.equal(harness.createCalls.length, 1);
		assert.equal(harness.createCalls[0].fromEmail, undefined);
		assert.equal(harness.createCalls[0].fromName, "Broken Sender");

		const fromAddressSaved = harness.addressCalls.some(
			(a) => a.localPart === "missing_mailbox",
		);
		assert.equal(fromAddressSaved, false);
	});

	it("persists fromEmail and the address record for a valid sender", async () => {
		const harness = await runWith([
			{ name: "Alice", mailbox: "alice", host: "example.com" },
		]);

		assert.equal(harness.createCalls.length, 1);
		assert.equal(harness.createCalls[0].fromEmail, "alice@example.com");
		assert.equal(harness.createCalls[0].fromName, "Alice");

		const fromAddressSaved = harness.addressCalls.some(
			(a) => a.localPart === "alice" && a.domain === "example.com",
		);
		assert.equal(fromAddressSaved, true);
	});
});

// ---------------------------------------------------------------------------
// Thread root derivation: every persisted Message gets a ThreadMessage row.
// A message with no References, no In-Reply-To, and no usable Message-ID
// header (missing or a "<>" delivery-failure placeholder) must still create a
// standalone thread-of-one off the always-present internal messageId — never
// early-return (orphan, invisible message) and never collapse distinct "<>"
// messages into one bogus thread.
// ---------------------------------------------------------------------------

describe("MessageSyncService.createThreadForMessage — thread root fallback", () => {
	const ACCOUNT_ID = "acc-1";
	const MAILBOX_ID = "mbx-1";

	const baseEnvelope: ImapEnvelope = {
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
	};

	const makeMessage = (uid: number, envelope: ImapEnvelope): ImapMessage => ({
		...aliceMessage,
		uid,
		references: undefined,
		envelope,
	});

	const internalMessageId = (uid: number, envelope: ImapEnvelope): string =>
		MessageService.generateIdFromSource(ACCOUNT_ID, {
			messageId: envelope.messageId,
			uid,
			mailboxId: MAILBOX_ID,
			date: envelope.date,
			subject: envelope.subject,
			fromMailbox: envelope.from?.[0]?.mailbox,
			fromHost: envelope.from?.[0]?.host,
		});

	const runWith = async (msgs: ImapMessage[]) => {
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
		await service.syncMessages(MAILBOX_ID, ACCOUNT_ID, "acc-cfg-1", 50);
		return fake.createCalls;
	};

	it("creates a thread-of-one off the internal id when no References, In-Reply-To, or Message-ID header", async () => {
		const envelope: ImapEnvelope = {
			...baseEnvelope,
			inReplyTo: "",
			messageId: "",
		};
		const headerless = makeMessage(77, envelope);

		const createCalls = await runWith([headerless]);

		assert.equal(createCalls.length, 1);
		const expectedId = internalMessageId(77, envelope);
		assert.equal(
			createCalls[0]?.threadId,
			ThreadMessageService.deriveThreadId(ACCOUNT_ID, expectedId),
		);
		assert.equal(createCalls[0]?.messageId, expectedId);
	});

	it("gives two distinct '<>' messages distinct threadIds (no collision)", async () => {
		const firstEnvelope: ImapEnvelope = {
			...baseEnvelope,
			subject: "bounce one",
			inReplyTo: "",
			messageId: "<>",
		};
		const secondEnvelope: ImapEnvelope = {
			...baseEnvelope,
			subject: "bounce two",
			inReplyTo: "",
			messageId: "<>",
		};

		const createCalls = await runWith([
			makeMessage(81, firstEnvelope),
			makeMessage(82, secondEnvelope),
		]);

		assert.equal(createCalls.length, 2);
		const threadIds = createCalls.map((c) => c.threadId);
		assert.notEqual(threadIds[0], threadIds[1]);
		assert.equal(
			threadIds[0],
			ThreadMessageService.deriveThreadId(
				ACCOUNT_ID,
				internalMessageId(81, firstEnvelope),
			),
		);
		assert.equal(
			threadIds[1],
			ThreadMessageService.deriveThreadId(
				ACCOUNT_ID,
				internalMessageId(82, secondEnvelope),
			),
		);
	});

	it("threads off a valid Message-ID header when no References or In-Reply-To (no regression)", async () => {
		const envelope: ImapEnvelope = {
			...baseEnvelope,
			inReplyTo: "",
			messageId: "<root-90@example.com>",
		};

		const createCalls = await runWith([makeMessage(90, envelope)]);

		assert.equal(createCalls.length, 1);
		assert.equal(
			createCalls[0]?.threadId,
			ThreadMessageService.deriveThreadId(ACCOUNT_ID, "<root-90@example.com>"),
		);
	});
});

describe("MessageSyncService.syncMessages — resync does not revert a pending local flag (issue #1273)", () => {
	it("never calls ThreadMessage.update for an existing row, even when IMAP still reports the pre-flip flag state", async () => {
		// Simulates: the user marked the message unread locally (a pending
		// MessageFlagPush marker for \Seen/remove is durable, but IMAP has not
		// confirmed the push yet — the server still reports \Seen). A sync
		// round touches this mailbox in the meantime. `createThreadForMessage`
		// only ever `create()`s a ThreadMessage — on an existing row that
		// conflicts and is caught as a no-op, so nothing here can revert the
		// local isRead=false intent back to true.
		const mailboxService = {
			get: async () => ({
				fullPath: "INBOX",
				uidValidity: 1,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				messageCount: 0,
			}),
			update: async () => undefined,
		} as unknown as MailboxService;

		const messageService = {
			upsertWithStatus: async (input: { mailboxId: string }) => ({
				item: { mailboxId: input.mailboxId },
				created: false,
			}),
		} as unknown as MessageService;

		const envelopeService = {
			upsertEnvelope: async () => undefined,
			upsertBodyParts: async () => undefined,
		} as unknown as EnvelopeService;

		const addressService = {
			upsertAddress: async () => undefined,
			upsertEnvelopeAddress: async () => undefined,
		} as unknown as AddressService;

		let updateCalls = 0;
		const threadMessageService = {
			create: async () => {
				// Existing row — matches ElectroDB's real create-conflict
				// semantics (message-sync.ts catches exactly this name and
				// no-ops).
				const err = new Error("conflict");
				(err as { name?: string }).name = "CreateFailedConflictError";
				throw err;
			},
			update: async () => {
				updateCalls++;
				throw new Error(
					"resync must never call ThreadMessage.update on an existing row — that would revert a pending local flag",
				);
			},
		} as unknown as ThreadMessageService;

		// aliceMessage.flags carries \Seen — the server's (stale, pre-push)
		// view — while the local row (not modeled here, since create() never
		// reaches an update) is presumed isRead=false from the user's pending
		// unread flip.
		const factory = buildConnectionFactory([aliceMessage]);
		const service = new MessageSyncService(
			factory,
			mailboxService,
			messageService,
			envelopeService,
			addressService,
			threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		// The conflict is swallowed, not a failure — the message still counts
		// as synced (envelope/body work happened), just not newly threaded.
		assert.equal(result.syncedCount, 1);
		assert.equal(updateCalls, 0);
	});
});

describe("MessageSyncService.syncMessages — UIDVALIDITY cursor (#1272)", () => {
	interface ExistingRow {
		messageId: string;
		messageIdHeader: string;
		internalDate: number;
		uid: number;
		threadMessageId?: string;
		accountConfigId?: string;
		sentDate?: number;
		mailboxId?: string;
		isRead?: boolean;
		isDeleted?: boolean;
		hasStars?: boolean;
		hasAttachment?: boolean;
	}

	const buildFakes = (opts: {
		mailboxCursorState?: string;
		mailboxUidValidity?: number;
		existingRows?: ExistingRow[];
	}) => {
		const updateCalls: Array<Record<string, unknown>> = [];
		const updateUidCalls: Array<{
			messageId: string;
			newUid: number;
			newMailboxId: string;
		}> = [];
		const deleteCalls: string[] = [];
		const updateThreadMessageCalls: Array<{
			accountConfigId: string;
			threadMessageId: string;
			input: Record<string, unknown>;
		}> = [];

		const mailboxService = {
			get: async () => ({
				mailboxId: "mbx-1",
				fullPath: "INBOX",
				uidValidity: opts.mailboxUidValidity ?? 1,
				lastSyncUid: 5,
				highWaterMarkUid: 20,
				cursorState: opts.mailboxCursorState,
			}),
			update: async (
				_accountId: string,
				_mailboxId: string,
				patch: Record<string, unknown>,
			) => {
				updateCalls.push(patch);
				return {};
			},
		} as unknown as MailboxService;

		const messageService = {
			updateUid: async (
				messageId: string,
				newUid: number,
				newMailboxId: string,
			) => {
				updateUidCalls.push({ messageId, newUid, newMailboxId });
				return {};
			},
			delete: async (messageId: string) => {
				deleteCalls.push(messageId);
			},
			upsertWithStatus: async (input: { mailboxId: string }) => ({
				item: { mailboxId: input.mailboxId },
				created: true,
			}),
		} as unknown as MessageService;

		const envelopeService = {
			upsertEnvelope: async () => undefined,
			upsertBodyParts: async () => undefined,
		} as unknown as EnvelopeService;

		const addressService = {
			upsertAddress: async () => undefined,
			upsertEnvelopeAddress: async () => undefined,
		} as unknown as AddressService;

		const threadMessageService = {
			listByMailbox: async () => ({
				items: (opts.existingRows ?? []).map((row) => ({
					messageId: row.messageId,
					messageIdHeader: row.messageIdHeader,
					internalDate: row.internalDate,
					uid: row.uid,
					threadMessageId: row.threadMessageId ?? `tm-${row.messageId}`,
					accountConfigId: row.accountConfigId ?? "acc-cfg-1",
					sentDate: row.sentDate ?? row.internalDate,
					mailboxId: row.mailboxId ?? "mbx-1",
					isRead: row.isRead ?? false,
					isDeleted: row.isDeleted ?? false,
					hasStars: row.hasStars ?? false,
					hasAttachment: row.hasAttachment ?? false,
				})),
				continuationToken: undefined,
			}),
			findAllByMessageId: async () => [],
			deleteMany: async () => undefined,
			create: async () => ({}),
			update: async (
				accountConfigId: string,
				threadMessageId: string,
				input: Record<string, unknown>,
			) => {
				updateThreadMessageCalls.push({
					accountConfigId,
					threadMessageId,
					input,
				});
				return {};
			},
		} as unknown as ThreadMessageService;

		return {
			mailboxService,
			messageService,
			envelopeService,
			addressService,
			threadMessageService,
			updateCalls,
			updateUidCalls,
			deleteCalls,
			updateThreadMessageCalls,
		};
	};

	const buildRebuildConnectionFactory = (opts: {
		servedUidValidity: number;
		serverSnapshots: Array<{
			uid: number;
			messageId: string;
			internalDate: Date;
		}>;
		newMessages?: ImapMessage[];
	}): ManagedConnectionFactory => {
		const conn = {
			openBox: async () => ({
				uidvalidity: opts.servedUidValidity,
				uidnext: 999,
				messageCount: opts.serverSnapshots.length,
			}),
			search: async () => opts.serverSnapshots.map((s) => s.uid),
			fetchEnvelopeSnapshots: async () => opts.serverSnapshots,
			fetchMessages: async (uids: number[]) =>
				(opts.newMessages ?? []).filter((m) => uids.includes(m.uid)),
			getMailboxStatus: async () => ({
				unseen: 0,
				deletedCount: 0,
				highestModseq: 42,
				messages: opts.serverSnapshots.length,
			}),
		};
		return { getConnection: () => conn } as unknown as ManagedConnectionFactory;
	};

	it("trips cursor_invalid and skips this sync round when the served UIDVALIDITY disagrees with the stored value", async () => {
		const fakes = buildFakes({ mailboxUidValidity: 1 });
		const factory = {
			getConnection: () => ({
				openBox: async () => ({ uidvalidity: 2, uidnext: 10, messageCount: 1 }),
				getMailboxStatus: async () => ({ unseen: 0, deletedCount: 0 }),
				search: async () => [10],
				fetchMessages: async () => [messageWithUid(10, "<a@x>")],
			}),
		} as unknown as ManagedConnectionFactory;

		const service = new MessageSyncService(
			factory,
			fakes.mailboxService,
			fakes.messageService,
			fakes.envelopeService,
			fakes.addressService,
			fakes.threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		assert.deepEqual(result, {
			syncedCount: 0,
			syncedMessageIds: [],
			syncedMessages: [],
			hasMore: false,
			remainingCount: 0,
		});
		assert.equal(fakes.updateCalls.length, 1);
		assert.deepEqual(fakes.updateCalls[0], {
			cursorState: MailboxCursorState.cursor_invalid,
		});
	});

	it("does not trip and proceeds normally when the served UIDVALIDITY matches", async () => {
		const fakes = buildFakes({ mailboxUidValidity: 1 });
		// uid 30 exceeds the fixture's highWaterMarkUid (20), so it is picked up
		// as a new message rather than falling into the "no new messages" branch.
		const factory = buildConnectionFactory([messageWithUid(30, "<a@x>")]);

		const service = new MessageSyncService(
			factory,
			fakes.mailboxService,
			fakes.messageService,
			fakes.envelopeService,
			fakes.addressService,
			fakes.threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		assert.equal(result.syncedCount, 1);
		assert.equal(
			fakes.updateCalls.some((c) => "cursorState" in c),
			false,
			"a matching UIDVALIDITY must never write cursorState",
		);
	});

	it("runs the envelope-pass rebuild instead of a normal sync when cursorState is cursor_invalid, matching/new/stale rows, then returns to normal", async () => {
		const fakes = buildFakes({
			mailboxCursorState: MailboxCursorState.cursor_invalid,
			existingRows: [
				{
					messageId: "msg-keep",
					messageIdHeader: "<keep@x>",
					internalDate: 1000,
					uid: 5,
				},
				{
					messageId: "msg-gone",
					messageIdHeader: "<gone@x>",
					internalDate: 2000,
					uid: 6,
				},
			],
		});

		const newMsg = messageWithUid(300, "<new@x>");
		const factory = buildRebuildConnectionFactory({
			servedUidValidity: 2,
			serverSnapshots: [
				{ uid: 105, messageId: "<keep@x>", internalDate: new Date(1000) },
				{ uid: 300, messageId: "<new@x>", internalDate: new Date(3000) },
			],
			newMessages: [newMsg],
		});

		const service = new MessageSyncService(
			factory,
			fakes.mailboxService,
			fakes.messageService,
			fakes.envelopeService,
			fakes.addressService,
			fakes.threadMessageService,
		);

		const result = await service.syncMessages(
			"mbx-1",
			"acc-1",
			"acc-cfg-1",
			50,
		);

		// Match: msg-keep's UID mapping is rewritten in place on Message...
		assert.deepEqual(fakes.updateUidCalls, [
			{ messageId: "msg-keep", newUid: 105, newMailboxId: "mbx-1" },
		]);
		// ...and on the denormalized ThreadMessage row too (#1272 review finding
		// 3) — a normal move keeps both in sync, so the rebuild must as well.
		assert.deepEqual(fakes.updateThreadMessageCalls, [
			{
				accountConfigId: "acc-cfg-1",
				threadMessageId: "tm-msg-keep",
				input: { uid: 105 },
			},
		]);
		// Stale: msg-gone has no counterpart on the server — reconciled (row deleted).
		assert.deepEqual(fakes.deleteCalls, ["msg-gone"]);
		// New: uid 300 has no existing row — goes through normal new-message sync.
		assert.equal(result.syncedCount, 1);
		assert.equal(result.syncedMessages[0]?.uid, 300);

		// First write stamps `rebuilding` before any other write, for crash safety.
		assert.equal(
			fakes.updateCalls[0]?.cursorState,
			MailboxCursorState.rebuilding,
		);

		// Final write rebuilds watermarks from the fresh axis and returns to normal.
		const finalUpdate = fakes.updateCalls.at(-1);
		assert.equal(finalUpdate?.cursorState, MailboxCursorState.normal);
		assert.equal(finalUpdate?.uidValidity, 2);
		assert.equal(finalUpdate?.highWaterMarkUid, 300);
		assert.equal(finalUpdate?.lastSyncUid, 105);
	});

	it("resumes (idempotently) when a prior rebuild crashed mid-way and left the mailbox in rebuilding", async () => {
		const fakes = buildFakes({
			mailboxCursorState: MailboxCursorState.rebuilding,
			existingRows: [],
		});
		const factory = buildRebuildConnectionFactory({
			servedUidValidity: 9,
			serverSnapshots: [],
		});

		const service = new MessageSyncService(
			factory,
			fakes.mailboxService,
			fakes.messageService,
			fakes.envelopeService,
			fakes.addressService,
			fakes.threadMessageService,
		);

		await service.syncMessages("mbx-1", "acc-1", "acc-cfg-1", 50);

		assert.equal(
			fakes.updateCalls[0]?.cursorState,
			MailboxCursorState.rebuilding,
		);
		assert.equal(
			fakes.updateCalls.at(-1)?.cursorState,
			MailboxCursorState.normal,
		);
		assert.equal(
			fakes.updateCalls.at(-1)?.uidValidity,
			9,
			"the rebuild re-reads UIDVALIDITY fresh rather than trusting the stale stored value",
		);
	});
});
