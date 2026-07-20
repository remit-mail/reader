/**
 * The two ways an enumeration round used to let go of a message without a
 * record of it (issue #72).
 *
 * A message with no ENVELOPE was counted as saved and the watermark moved past
 * it. A UID the FETCH never returned a row for was counted the same way. Both
 * are now visible: the first as a quarantine record, the second as work the
 * round did not finish.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	IQuarantineRepository,
	IThreadMessageRepository,
	IUnitOfWork,
	MailboxItem,
	QuarantineItem,
	QuarantineUpsertInput,
	UpdateMailboxInput,
} from "@remit/data-ports";
import { MailboxCursorState } from "@remit/domain-enums";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { MessageSyncService } from "./message-sync.js";
import { QuarantineService } from "./quarantine.js";
import type { IImapConnection, ImapMessage } from "./types.js";

const ACCOUNT_ID = "acc-1";
const ACCOUNT_CONFIG_ID = "cfg-1";
const MAILBOX_ID = "mbx-1";
const UID_VALIDITY = 100;

const mailbox = {
	mailboxId: MAILBOX_ID,
	accountId: ACCOUNT_ID,
	fullPath: "INBOX",
	uidValidity: UID_VALIDITY,
	lastSyncUid: 0,
	highWaterMarkUid: 20,
	highestModseq: "0",
	cursorState: MailboxCursorState.normal,
} as MailboxItem;

const withEnvelope = (uid: number): ImapMessage => ({
	uid,
	seq: uid,
	flags: [],
	internalDate: new Date("2026-01-01T00:00:00Z"),
	size: 42,
	envelope: {
		date: "Thu, 01 Jan 2026 00:00:00 +0000",
		subject: "Hello",
		from: [{ mailbox: "sender", host: "example.com" }],
		sender: [],
		replyTo: [],
		to: [{ mailbox: "me", host: "example.com" }],
		cc: [],
		bcc: [],
		inReplyTo: "",
		messageId: `<${uid}@example.com>`,
	},
});

const withoutEnvelope = (uid: number): ImapMessage => ({
	uid,
	seq: uid,
	flags: [],
	internalDate: new Date("2026-01-01T00:00:00Z"),
	size: 42,
	bodyStructure: { type: "text/plain", encoding: "7bit" },
});

const buildHarness = (options: {
	allUids: number[];
	enumerated: ImapMessage[];
	existing?: QuarantineItem[];
	upsertFails?: boolean;
}) => {
	const mailboxUpdates: UpdateMailboxInput[] = [];
	const writes: QuarantineUpsertInput[] = [];
	const fetched: number[][] = [];

	const connection = {
		openBox: async () => ({ uidvalidity: UID_VALIDITY, uidnext: 99 }),
		getMailboxStatus: async () => ({
			messages: 10,
			recent: 0,
			unseen: 1,
			uidNext: 99,
			uidValidity: UID_VALIDITY,
			highestModseq: "600",
			deletedCount: 0,
		}),
		supportsCondstore: () => false,
		search: async () => options.allUids,
		fetchMessages: async (uids: number[]) => {
			fetched.push(uids);
			return options.enumerated.filter((msg) => uids.includes(msg.uid));
		},
	} as unknown as IImapConnection;

	const mailboxService = {
		get: async () => mailbox,
		update: async (_a: string, _m: string, input: UpdateMailboxInput) => {
			mailboxUpdates.push(input);
			return mailbox;
		},
	} as unknown as IMailboxRepository;

	const threadMessageService = {
		findByMessageId: async () => null,
		findAllByMessageId: async () => [],
		create: async () => ({ threadMessageId: "tm-1" }),
		update: async () => ({ threadMessageId: "tm-1" }),
	} as unknown as IThreadMessageRepository;

	const unitOfWork: IUnitOfWork = {
		transaction: (fn) =>
			fn({
				message: {
					upsertWithStatus: async (input: { mailboxId: string }) => ({
						item: { mailboxId: input.mailboxId },
						created: true,
					}),
					updateUid: async () => undefined,
				} as unknown as IMessageRepository,
				envelope: {
					upsertEnvelope: async () => undefined,
					upsertBodyParts: async () => undefined,
				} as unknown as IEnvelopeRepository,
				address: {
					upsertAddress: async () => undefined,
					upsertEnvelopeAddress: async () => undefined,
				} as unknown as IAddressRepository,
				threadMessage: threadMessageService,
			}),
	};

	const repository = {
		listByAccountConfigId: async () => options.existing ?? [],
		upsert: async (input: QuarantineUpsertInput) => {
			if (options.upsertFails) throw new Error("database unavailable");
			writes.push(input);
		},
	} satisfies IQuarantineRepository;

	const service = new MessageSyncService(
		{
			getConnection: () => connection,
			close: async () => {},
		} as ManagedConnectionFactory,
		mailboxService,
		{} as IMessageRepository,
		{} as IEnvelopeRepository,
		{} as IAddressRepository,
		threadMessageService,
		{ info: () => {}, warn: () => {}, error: () => {} },
		unitOfWork,
		undefined,
		undefined,
		new QuarantineService(
			repository,
			{
				listByMailboxId: async () => [],
			} as unknown as IMailboxSpecialUseRepository,
			"sha-abc",
			{ info: () => {}, warn: () => {} },
		),
	);

	return { service, mailboxUpdates, writes, fetched };
};

const sync = (service: MessageSyncService) =>
	service.syncMessages(MAILBOX_ID, ACCOUNT_ID, ACCOUNT_CONFIG_ID, 50);

describe("a message that arrives without an ENVELOPE", () => {
	it("is recorded rather than skipped in silence", async () => {
		const harness = buildHarness({
			allUids: [21],
			enumerated: [withoutEnvelope(21)],
		});

		await sync(harness.service);

		assert.equal(harness.writes.length, 1);
		assert.equal(harness.writes[0]?.uid, 21);
		assert.equal(harness.writes[0]?.failureStage, "MessageEnvelope");
		assert.equal(harness.writes[0]?.failureCode, "MissingEnvelope");
	});

	it("lets the watermark move past it, so one bad message cannot stall the mailbox", async () => {
		const harness = buildHarness({
			allUids: [21],
			enumerated: [withoutEnvelope(21)],
		});

		await sync(harness.service);

		assert.equal(harness.mailboxUpdates[0]?.highWaterMarkUid, 21);
	});

	it("carries the shape the FETCH did supply, which is the repro fingerprint", async () => {
		const harness = buildHarness({
			allUids: [21],
			enumerated: [withoutEnvelope(21)],
		});

		await sync(harness.service);

		assert.equal(harness.writes[0]?.contentType, "text/plain");
		assert.deepEqual(harness.writes[0]?.structure, [
			{ depth: 0, contentType: "text/plain" },
		]);
	});

	it("holds the watermark when the record itself could not be written", async () => {
		const harness = buildHarness({
			allUids: [21],
			enumerated: [withoutEnvelope(21)],
			upsertFails: true,
		});

		await sync(harness.service);

		// A failed write is database work failing, not the message being
		// resolved. Nothing may move past it.
		assert.equal(harness.mailboxUpdates[0]?.highWaterMarkUid, 20);
	});
});

describe("a uid already quarantined", () => {
	it("is not fetched again, but the watermark still passes it", async () => {
		const harness = buildHarness({
			allUids: [21, 22],
			enumerated: [withEnvelope(22)],
			existing: [
				{
					mailboxId: MAILBOX_ID,
					uidValidity: UID_VALIDITY,
					uid: 21,
				} as QuarantineItem,
			],
		});

		await sync(harness.service);

		assert.deepEqual(harness.fetched, [[22]]);
		assert.equal(harness.mailboxUpdates[0]?.highWaterMarkUid, 22);
	});
});

describe("a uid the FETCH returned no row for", () => {
	it("does not count as consumed, so the watermark stops below it", async () => {
		const harness = buildHarness({
			allUids: [21, 22],
			// The server (or the client library, #408) hands back only one row.
			enumerated: [withEnvelope(21)],
		});

		await sync(harness.service);

		assert.equal(harness.mailboxUpdates[0]?.highWaterMarkUid, 21);
	});

	it("keeps the mailbox on enumeration rather than seeding a mod-sequence over it", async () => {
		const harness = buildHarness({
			allUids: [21, 22],
			enumerated: [withEnvelope(21)],
		});

		await sync(harness.service);

		assert.equal(harness.mailboxUpdates[0]?.highestModseq, undefined);
	});
});
