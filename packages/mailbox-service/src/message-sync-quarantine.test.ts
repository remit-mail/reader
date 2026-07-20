/**
 * The ways an enumeration round used to let go of a message without a record of
 * it (issue #72).
 *
 * A row carrying no ENVELOPE was counted as saved and the watermark moved past
 * it; so was a UID the FETCH never returned a row for. Neither is attributable
 * to the message — an absent envelope is indistinguishable from the FETCH row
 * glitching — so neither is quarantined. Both are now failures the watermark
 * must stop below, which is the only treatment that survives a gap in the
 * middle of a batch.
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

const buildMailbox = (over: Partial<MailboxItem> = {}): MailboxItem =>
	({
		mailboxId: MAILBOX_ID,
		accountId: ACCOUNT_ID,
		fullPath: "INBOX",
		uidValidity: UID_VALIDITY,
		lastSyncUid: 0,
		highWaterMarkUid: 20,
		highestModseq: "0",
		cursorState: MailboxCursorState.normal,
		...over,
	}) as MailboxItem;

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
	lastSyncUid?: number;
	highWaterMarkUid?: number;
}) => {
	const mailbox = buildMailbox({
		...(options.lastSyncUid !== undefined
			? { lastSyncUid: options.lastSyncUid }
			: {}),
		...(options.highWaterMarkUid !== undefined
			? { highWaterMarkUid: options.highWaterMarkUid }
			: {}),
	});
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

describe("a row that carried no ENVELOPE", () => {
	it("is held for retry rather than set aside", async () => {
		const harness = buildHarness({
			allUids: [21],
			enumerated: [withoutEnvelope(21)],
		});

		await sync(harness.service);

		// Nothing can tell an envelope-less row apart from the FETCH glitching,
		// and the client is far more often the cause than the message. Recording
		// it would set aside mail that is fine.
		assert.deepEqual(harness.writes, []);
		assert.equal(harness.mailboxUpdates[0]?.highWaterMarkUid, 20);
	});

	it("keeps the mailbox on enumeration rather than seeding a mod-sequence over it", async () => {
		const harness = buildHarness({
			allUids: [21],
			enumerated: [withoutEnvelope(21)],
		});

		await sync(harness.service);

		assert.equal(harness.mailboxUpdates[0]?.highestModseq, undefined);
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
	it("stops the watermark below it when it is the highest of the batch", async () => {
		const harness = buildHarness({
			allUids: [22, 21],
			enumerated: [withEnvelope(21)],
		});

		await sync(harness.service);

		assert.equal(harness.mailboxUpdates[0]?.highWaterMarkUid, 21);
	});

	it("stops the watermark below it when it sits in the middle of the batch", async () => {
		const harness = buildHarness({
			allUids: [23, 22, 21],
			// 22's row is dropped; 23 above it saves fine.
			enumerated: [withEnvelope(23), withEnvelope(21)],
		});

		await sync(harness.service);

		// The watermark advances by MAX of what was applied, so absence alone
		// would let 23 carry it straight over the gap and lose 22 for good.
		assert.equal(harness.mailboxUpdates[0]?.highWaterMarkUid, 21);
	});

	it("stops the backfill floor above a gap, so it stays selectable", async () => {
		const harness = buildHarness({
			allUids: [12, 11, 10],
			enumerated: [withEnvelope(12), withEnvelope(10)],
			lastSyncUid: 20,
			highWaterMarkUid: 20,
		});

		await sync(harness.service);

		assert.equal(harness.mailboxUpdates[0]?.lastSyncUid, 12);
	});

	it("keeps the mailbox on enumeration rather than seeding a mod-sequence over it", async () => {
		const harness = buildHarness({
			allUids: [22, 21],
			enumerated: [withEnvelope(21)],
		});

		await sync(harness.service);

		assert.equal(harness.mailboxUpdates[0]?.highestModseq, undefined);
	});
});
