import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageFlagPushRepository,
	IMessageRepository,
	IThreadMessageRepository,
	IUnitOfWork,
	MailboxItem,
	ThreadMessageItem,
	UpdateMailboxInput,
	UpdateThreadMessageInput,
} from "@remit/data-ports";
import { MailboxCursorState } from "@remit/domain-enums";
import type { ManagedConnectionFactory } from "./connection-factory.js";
import { MessageSyncService } from "./message-sync.js";
import type { IImapConnection, ImapMessage } from "./types.js";

const ACCOUNT_ID = "acc-1";
const ACCOUNT_CONFIG_ID = "cfg-1";
const MAILBOX_ID = "mbx-1";

const mailbox = (over: Partial<MailboxItem> = {}): MailboxItem =>
	({
		mailboxId: MAILBOX_ID,
		accountId: ACCOUNT_ID,
		fullPath: "INBOX",
		uidValidity: 100,
		lastSyncUid: 1,
		highWaterMarkUid: 20,
		highestModseq: "500",
		cursorState: MailboxCursorState.normal,
		...over,
	}) as MailboxItem;

const serverMessage = (over: Partial<ImapMessage> = {}): ImapMessage => ({
	uid: 21,
	seq: 21,
	flags: [],
	internalDate: new Date("2026-01-01T00:00:00Z"),
	size: 42,
	modseq: "510",
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
		messageId: "<a@example.com>",
	},
	...over,
});

const storedRow = (over: Partial<ThreadMessageItem> = {}): ThreadMessageItem =>
	({
		threadMessageId: "tm-1",
		messageId: "msg-1",
		accountConfigId: ACCOUNT_CONFIG_ID,
		mailboxId: MAILBOX_ID,
		threadId: "thr-1",
		uid: 21,
		sentDate: 1_767_225_600_000,
		internalDate: 1_767_225_600_000,
		isRead: false,
		isDeleted: false,
		hasStars: false,
		hasAttachment: false,
		...over,
	}) as ThreadMessageItem;

interface HarnessOptions {
	mailbox: MailboxItem;
	supportsCondstore: boolean;
	/** UIDVALIDITY the server serves, when it differs from the stored one. */
	servedUidValidity?: number;
	serverModseq?: string;
	changed?: ImapMessage[];
	allUids?: number[];
	enumerated?: ImapMessage[];
	/** Stored rows, keyed by the messageId the sync derives. */
	storedRows?: ThreadMessageItem[];
	/** Flag names with an outbound push still owed to IMAP. */
	pendingFlags?: Set<string>;
}

interface Harness {
	service: MessageSyncService;
	mailboxUpdates: UpdateMailboxInput[];
	threadUpdates: Array<{
		threadMessageId: string;
		input: UpdateThreadMessageInput;
	}>;
	created: string[];
	calls: { search: number; fetchMessages: number; changedSince: bigint[] };
}

const buildHarness = (options: HarnessOptions): Harness => {
	const mailboxUpdates: UpdateMailboxInput[] = [];
	const threadUpdates: Array<{
		threadMessageId: string;
		input: UpdateThreadMessageInput;
	}> = [];
	const created: string[] = [];
	const calls = { search: 0, fetchMessages: 0, changedSince: [] as bigint[] };
	const rows = options.storedRows ?? [];
	const uidValidity = options.servedUidValidity ?? options.mailbox.uidValidity;

	const connection = {
		openBox: async () => ({ uidvalidity: uidValidity, uidnext: 99 }),
		getMailboxStatus: async () => ({
			messages: 10,
			recent: 0,
			unseen: 1,
			uidNext: 99,
			uidValidity,
			highestModseq: options.serverModseq ?? "600",
			deletedCount: 0,
		}),
		supportsCondstore: () => options.supportsCondstore,
		fetchMessagesChangedSince: async (since: bigint) => {
			calls.changedSince.push(since);
			return options.changed ?? [];
		},
		search: async () => {
			calls.search++;
			return options.allUids ?? [];
		},
		fetchMessages: async () => {
			calls.fetchMessages++;
			return options.enumerated ?? [];
		},
		fetchEnvelopeSnapshots: async () => [],
	} as unknown as IImapConnection;

	const connectionFactory = {
		getConnection: () => connection,
		close: async () => {},
	} as ManagedConnectionFactory;

	const mailboxService = {
		get: async () => options.mailbox,
		update: async (_a: string, _m: string, input: UpdateMailboxInput) => {
			mailboxUpdates.push(input);
			return options.mailbox;
		},
	} as unknown as IMailboxRepository;

	// The sync derives its own messageId from the server envelope, so the fake
	// answers by UID — the one field a test can state up front.
	const threadMessageService = {
		findByMessageId: async () => rows[0] ?? null,
		findAllByMessageId: async () => rows,
		listByMailbox: async () => ({ items: rows, continuationToken: undefined }),
		update: async (
			_cfg: string,
			threadMessageId: string,
			input: UpdateThreadMessageInput,
		) => {
			threadUpdates.push({ threadMessageId, input });
			return storedRow();
		},
		create: async (input: { messageId: string }) => {
			created.push(input.messageId);
			return storedRow();
		},
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

	const flagPushMarkerService = {
		find: async (_messageId: string, flagName: string) =>
			options.pendingFlags?.has(flagName)
				? { messageId: _messageId, flagName }
				: null,
	} as unknown as IMessageFlagPushRepository;

	const service = new MessageSyncService(
		connectionFactory,
		mailboxService,
		{} as IMessageRepository,
		{} as IEnvelopeRepository,
		{} as IAddressRepository,
		threadMessageService,
		undefined,
		unitOfWork,
		flagPushMarkerService,
	);

	return { service, mailboxUpdates, threadUpdates, created, calls };
};

const syncOnce = (harness: Harness, batchSize = 50) =>
	harness.service.syncMessages(
		MAILBOX_ID,
		ACCOUNT_ID,
		ACCOUNT_CONFIG_ID,
		batchSize,
	);

describe("MessageSyncService CHANGEDSINCE path", () => {
	it("picks up a read-state change made on another client without enumerating the folder", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ flags: ["\\Seen"] })],
			storedRows: [storedRow({ isRead: false })],
		});

		await syncOnce(harness);

		assert.deepEqual(harness.calls.changedSince, [500n]);
		assert.equal(harness.calls.search, 0);
		assert.equal(harness.calls.fetchMessages, 0);
		assert.deepEqual(harness.threadUpdates, [
			{ threadMessageId: "tm-1", input: { isRead: true } },
		]);
	});

	it("picks up a star set on another client", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ flags: ["\\Flagged"] })],
			storedRows: [storedRow({ hasStars: false })],
		});

		await syncOnce(harness);

		assert.deepEqual(harness.threadUpdates, [
			{ threadMessageId: "tm-1", input: { hasStars: true } },
		]);
	});

	it("writes nothing when the server flags already match the stored row", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ flags: ["\\Seen"] })],
			storedRows: [storedRow({ isRead: true })],
		});

		await syncOnce(harness);

		assert.deepEqual(harness.threadUpdates, []);
	});

	it("leaves a field alone while its local flip is still owed to IMAP", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ flags: [] })],
			storedRows: [storedRow({ isRead: true })],
			pendingFlags: new Set(["Seen"]),
		});

		await syncOnce(harness);

		assert.deepEqual(harness.threadUpdates, []);
	});

	it("still discovers a new message and reports it for body sync", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ uid: 31, modseq: "515" })],
			storedRows: [],
		});

		const result = await syncOnce(harness);

		assert.equal(harness.calls.search, 0);
		assert.equal(result.syncedCount, 1);
		assert.deepEqual(
			result.syncedMessages.map((m) => m.uid),
			[31],
		);
		assert.equal(harness.created.length, 1);
	});

	it("advances the watermark to the server value once the round is applied", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			serverModseq: "600",
			changed: [serverMessage({ uid: 31, modseq: "515" })],
			storedRows: [],
		});

		const result = await syncOnce(harness);

		assert.equal(result.hasMore, false);
		assert.equal(harness.mailboxUpdates[0].highestModseq, "600");
		assert.equal(harness.mailboxUpdates[0].highWaterMarkUid, 31);
	});

	it("advances only over the batch it applied and asks to be resumed", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			serverModseq: "600",
			changed: [
				serverMessage({ uid: 31, modseq: "515" }),
				serverMessage({ uid: 32, modseq: "525" }),
			],
			storedRows: [],
		});

		const result = await syncOnce(harness, 1);

		assert.equal(result.hasMore, true);
		assert.equal(result.remainingCount, 1);
		assert.equal(harness.mailboxUpdates[0].highestModseq, "515");
	});
});

describe("MessageSyncService without CONDSTORE", () => {
	it("falls back to full enumeration and never issues CHANGEDSINCE", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: false,
			allUids: [],
			serverModseq: "0",
		});

		await syncOnce(harness);

		assert.deepEqual(harness.calls.changedSince, []);
		assert.equal(harness.calls.search, 1);
		assert.equal(harness.mailboxUpdates[0].highestModseq, "0");
	});

	it("enumerates while no mod-sequence watermark has been seeded yet", async () => {
		const harness = buildHarness({
			mailbox: mailbox({ highestModseq: "0" }),
			supportsCondstore: true,
			allUids: [],
		});

		await syncOnce(harness);

		assert.deepEqual(harness.calls.changedSince, []);
		assert.equal(harness.calls.search, 1);
	});

	it("seeds the mod-sequence watermark once enumeration finds nothing left", async () => {
		const harness = buildHarness({
			mailbox: mailbox({ highestModseq: "0" }),
			supportsCondstore: true,
			allUids: [],
			serverModseq: "700",
		});

		await syncOnce(harness);

		assert.equal(harness.mailboxUpdates[0].highestModseq, "700");
	});

	it("withholds the seed while enumeration still has work left", async () => {
		const harness = buildHarness({
			mailbox: mailbox({ highestModseq: "0" }),
			supportsCondstore: true,
			allUids: [21, 22],
			enumerated: [serverMessage({ uid: 21 }), serverMessage({ uid: 22 })],
			serverModseq: "700",
			storedRows: [],
		});

		await syncOnce(harness, 1);

		assert.equal(harness.mailboxUpdates[0].highestModseq, undefined);
	});
});

describe("MessageSyncService UIDVALIDITY reseed", () => {
	it("trips the cursor instead of trusting the stored mod-sequence", async () => {
		const harness = buildHarness({
			mailbox: mailbox({ uidValidity: 100 }),
			servedUidValidity: 777,
			supportsCondstore: true,
			changed: [serverMessage()],
		});

		const result = await syncOnce(harness);

		assert.deepEqual(result.syncedMessages, []);
		assert.deepEqual(harness.calls.changedSince, []);
		assert.deepEqual(harness.mailboxUpdates, [
			{ cursorState: MailboxCursorState.cursor_invalid },
		]);
	});

	it("reseeds the watermark from the new axis when the rebuild completes", async () => {
		const harness = buildHarness({
			mailbox: mailbox({
				cursorState: MailboxCursorState.cursor_invalid,
				highestModseq: "500",
			}),
			servedUidValidity: 777,
			supportsCondstore: true,
			serverModseq: "12",
			storedRows: [],
		});

		await syncOnce(harness);

		assert.deepEqual(harness.calls.changedSince, []);
		assert.deepEqual(harness.mailboxUpdates, [
			{ cursorState: MailboxCursorState.rebuilding },
			{
				cursorState: MailboxCursorState.normal,
				uidValidity: 777,
				highWaterMarkUid: 0,
				lastSyncUid: 0,
				highestModseq: "12",
				lastMessageSyncAt: harness.mailboxUpdates[1]?.lastMessageSyncAt,
				messageCount: 10,
				unseenCount: 1,
				deletedCount: 0,
			},
		]);
	});
});
