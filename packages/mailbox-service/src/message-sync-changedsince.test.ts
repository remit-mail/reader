import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	IAddressRepository,
	IEnvelopeRepository,
	IMailboxRepository,
	IMessageFlagPushRepository,
	IMessageFlagRepository,
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
import type { FlagPushService } from "./flag-push.js";
import { FlagQueueService } from "./flag-queue.js";
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
	/** Flag names already on the canonical MessageFlag record. */
	storedFlags?: string[];
	/** Envelope snapshots the cursor rebuild sees on the server. */
	snapshots?: Array<{ uid: number; messageId: string; internalDate: Date }>;
	/** UIDs whose save throws, to exercise the failure clamps. */
	failUids?: Set<number>;
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
	/** Alarm-shaped ERROR logs the round emitted. */
	errors: Array<Record<string, unknown>>;
	/** The canonical flag record after the round. */
	flagStore: Set<string>;
	messageFlagService: IMessageFlagRepository;
}

const buildHarness = (options: HarnessOptions): Harness => {
	const mailboxUpdates: UpdateMailboxInput[] = [];
	const threadUpdates: Array<{
		threadMessageId: string;
		input: UpdateThreadMessageInput;
	}> = [];
	const created: string[] = [];
	const calls = { search: 0, fetchMessages: 0, changedSince: [] as bigint[] };
	const errors: Array<Record<string, unknown>> = [];
	const logger = {
		info: () => {},
		warn: () => {},
		error: (obj: Record<string, unknown>) => {
			errors.push(obj);
		},
	};
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
		fetchEnvelopeSnapshots: async () => options.snapshots ?? [],
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
					upsertWithStatus: async (input: {
						mailboxId: string;
						uid: number;
					}) => {
						if (options.failUids?.has(input.uid)) {
							throw new Error(`save failed for uid ${input.uid}`);
						}
						return { item: { mailboxId: input.mailboxId }, created: true };
					},
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

	// The canonical flag record, as a set of flag names held per message.
	const flagStore = new Set<string>(options.storedFlags ?? []);
	const messageFlagService = {
		hasFlag: async (_messageId: string, flagName: string) =>
			flagStore.has(flagName),
		addFlag: async (_messageId: string, flagName: string) => {
			flagStore.add(flagName);
			return { flagName };
		},
		removeFlag: async (_messageId: string, flagName: string) => {
			flagStore.delete(flagName);
		},
	} as unknown as IMessageFlagRepository;

	const service = new MessageSyncService(
		connectionFactory,
		mailboxService,
		{} as IMessageRepository,
		{} as IEnvelopeRepository,
		{} as IAddressRepository,
		threadMessageService,
		logger,
		unitOfWork,
		flagPushMarkerService,
		messageFlagService,
	);

	return {
		service,
		mailboxUpdates,
		threadUpdates,
		created,
		calls,
		errors,
		flagStore,
		messageFlagService,
	};
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

	it("picks up a star set on another client, colour following the boolean", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ flags: ["\\Flagged"] })],
			storedRows: [storedRow({ hasStars: false })],
		});

		await syncOnce(harness);

		// #58: `hasStars` is the boolean of record and `star` its colour; the
		// two may never disagree.
		assert.deepEqual(harness.threadUpdates, [
			{
				threadMessageId: "tm-1",
				input: { hasStars: true, star: "yellow" },
			},
		]);
	});

	it("keeps a colour the user chose when the server re-flags", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ flags: ["\\Flagged"] })],
			storedRows: [storedRow({ hasStars: false, star: "purple" })],
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

	it("splits a bulk change across rounds without losing its tail", async () => {
		// One STORE marked 60 messages read, so all 60 carry mod-sequence 900.
		const bulk = Array.from({ length: 60 }, (_, i) =>
			serverMessage({ uid: 100 + i, modseq: "900" }),
		);
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			serverModseq: "900",
			changed: bulk,
			storedRows: [],
		});

		const first = await syncOnce(harness, 50);

		// The round is bounded, and the cursor records how far into the group it
		// got rather than claiming the whole of mod-sequence 900.
		assert.equal(harness.created.length, 50);
		assert.equal(first.hasMore, true);
		assert.equal(harness.mailboxUpdates[0].highestModseq, "500:149");

		// The next round asks from the last COMPLETE mod-sequence, so the server
		// serves the whole group again and the applied half is skipped.
		const resumed = buildHarness({
			mailbox: mailbox({ highestModseq: "500:149" }),
			supportsCondstore: true,
			serverModseq: "900",
			changed: bulk,
			storedRows: [],
		});

		const second = await syncOnce(resumed, 50);

		assert.deepEqual(resumed.calls.changedSince, [500n]);
		assert.equal(resumed.created.length, 10);
		assert.equal(second.hasMore, false);
		assert.equal(resumed.mailboxUpdates[0].highestModseq, "900");
	});

	it("keeps the cursor below a group it only partly applied", async () => {
		const bulk = [
			serverMessage({ uid: 99, modseq: "800" }),
			...Array.from({ length: 60 }, (_, i) =>
				serverMessage({ uid: 100 + i, modseq: "900" }),
			),
		];
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			serverModseq: "900",
			changed: bulk,
			storedRows: [],
		});

		const result = await syncOnce(harness, 50);

		assert.equal(result.hasMore, true);
		// Group 800 complete, 49 into group 900 — never a bare "900".
		assert.equal(harness.mailboxUpdates[0].highestModseq, "800:148");
	});

	it("reports a stalled cursor when a round moves nothing", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			serverModseq: "900",
			changed: [serverMessage({ uid: 31, modseq: "515" })],
			storedRows: [],
			failUids: new Set([31]),
		});

		const result = await syncOnce(harness);

		assert.equal(result.cursorStalled, true);
		assert.equal(harness.mailboxUpdates[0].highestModseq, "500");
		assert.equal(
			harness.errors.filter((e) => e.alert === "message_sync_cursor_stalled")
				.length,
			1,
		);
	});

	it("does not report a stall when the cursor moved", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ uid: 31, modseq: "515" })],
			storedRows: [],
		});

		const result = await syncOnce(harness);

		assert.equal(result.cursorStalled, false);
		assert.deepEqual(harness.errors, []);
	});

	it("writes the canonical flag record, not only the list projection", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ flags: ["\\Seen"] })],
			storedRows: [storedRow({ isRead: false })],
			storedFlags: [],
		});

		await syncOnce(harness);

		assert.deepEqual([...harness.flagStore], ["Seen"]);
	});

	it("clears the canonical flag and the star colour when the server unstars", async () => {
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ flags: [] })],
			storedRows: [storedRow({ hasStars: true })],
			storedFlags: ["Flagged"],
		});

		await syncOnce(harness);

		assert.deepEqual([...harness.flagStore], []);
		assert.deepEqual(harness.threadUpdates, [
			{
				threadMessageId: "tm-1",
				input: { hasStars: false, star: "none" },
			},
		]);
	});

	it("leaves the user's next flip a real flip, not a redundant no-op", async () => {
		// Another client marks the message read; the reader picks it up.
		const harness = buildHarness({
			mailbox: mailbox(),
			supportsCondstore: true,
			changed: [serverMessage({ flags: ["\\Seen"] })],
			storedRows: [storedRow({ isRead: false })],
			storedFlags: [],
		});

		await syncOnce(harness);

		// The user now clicks "mark unread". FlagQueueService decides whether
		// that is a real change by reading the canonical record.
		const pushes: Array<{ flagName: string; operation: string }> = [];
		const flagQueue = new FlagQueueService({
			messageFlagService: harness.messageFlagService,
			messageService: {
				get: async () => ({ mailboxId: MAILBOX_ID }),
			} as unknown as IMessageRepository,
			threadMessageService: {
				findAllByMessageId: async () => [storedRow({ isRead: true })],
				update: async () => storedRow(),
			} as unknown as IThreadMessageRepository,
			flagPushService: {
				flip: async (params: { flagName: string; operation: string }) => {
					pushes.push({
						flagName: params.flagName,
						operation: params.operation,
					});
				},
			} as unknown as FlagPushService,
		});

		await flagQueue.markAsUnread(ACCOUNT_CONFIG_ID, "msg-1", ACCOUNT_ID);

		assert.deepEqual(pushes, [{ flagName: "Seen", operation: "remove" }]);
		assert.deepEqual([...harness.flagStore], []);
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

	it("withholds the seed when the rebuild lost a message to a failed save", async () => {
		const harness = buildHarness({
			mailbox: mailbox({
				cursorState: MailboxCursorState.cursor_invalid,
				highestModseq: "500",
			}),
			servedUidValidity: 777,
			supportsCondstore: true,
			serverModseq: "12",
			allUids: [30, 31],
			snapshots: [
				{ uid: 30, messageId: "<a@example.com>", internalDate: new Date(0) },
				{ uid: 31, messageId: "<b@example.com>", internalDate: new Date(0) },
			],
			enumerated: [serverMessage({ uid: 30 }), serverMessage({ uid: 31 })],
			failUids: new Set([31]),
			storedRows: [],
		});

		await syncOnce(harness);

		const final = harness.mailboxUpdates[1];
		// Neither the stale value (meaningless on the new axis) nor the new one
		// (already above the message that failed).
		assert.equal(final.highestModseq, "0");
		// The forward watermark stops below the failure, so uid 31 is enumerated
		// again next round.
		assert.equal(final.highWaterMarkUid, 30);
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
