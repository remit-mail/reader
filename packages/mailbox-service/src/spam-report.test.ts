import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AddressFlags,
	IAccountRepository,
	IAddressRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageFlagPushRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import { AddressRole } from "@remit/domain-enums";
import { FlagPushService } from "./flag-push.js";
import { MessageMoveService } from "./message-move.js";
import { SpamReportService } from "./spam-report.js";

const ACCOUNT = "acc-1";
const ACCOUNT_CONFIG = "cfg-1";
const ACCOUNT_EMAIL = "me@example.com";
const INBOX_MAILBOX = "mbx-inbox";
const JUNK_MAILBOX = "mbx-junk";
const MESSAGE_ID = "msg-1";
const ADDRESS_ID = "addr-1";
const THREAD_ID = "thread-1";

interface ThreadRow {
	accountConfigId: string;
	threadMessageId: string;
	threadId: string;
	messageId: string;
	mailboxId: string;
	messageIdHeader: string;
	isRead?: boolean;
	hasStars?: boolean;
	hasAttachment?: boolean;
	isDeleted?: boolean;
}

interface World {
	service: SpamReportService;
	messages: Map<string, Record<string, unknown>>;
	addresses: Map<string, { flags: AddressFlags }>;
	sent: unknown[];
	sqsImpl: { send: (command: unknown) => Promise<unknown> };
	markerPuts: Array<Record<string, unknown>>;
}

const buildWorld = (
	opts: { startMailbox?: string; fromEmail?: string } = {},
): World => {
	const startMailbox = opts.startMailbox ?? INBOX_MAILBOX;
	const fromEmail = opts.fromEmail ?? "sender@example.com";

	const messages = new Map<string, Record<string, unknown>>([
		[
			MESSAGE_ID,
			{
				messageId: MESSAGE_ID,
				mailboxId: startMailbox,
				uid: 42,
				rfc822Size: 100,
				internalDate: 1_700_000_000_000,
				envelopeId: "env-1",
				rootBodyPartId: "body-1",
				category: "primary",
				hasListUnsubscribe: false,
				syncStatus: "synced",
			},
		],
	]);

	const addresses = new Map<string, { flags: AddressFlags }>([
		[ADDRESS_ID, { flags: {} }],
	]);

	const threadRows: ThreadRow[] = [
		{
			accountConfigId: ACCOUNT_CONFIG,
			threadMessageId: `tm:${THREAD_ID}::${MESSAGE_ID}`,
			threadId: THREAD_ID,
			messageId: MESSAGE_ID,
			mailboxId: INBOX_MAILBOX,
			messageIdHeader: "<abc@example.com>",
			isRead: false,
			hasStars: false,
		},
	];

	const mailboxes = new Map<string, Record<string, unknown>>([
		[
			INBOX_MAILBOX,
			{ mailboxId: INBOX_MAILBOX, fullPath: "INBOX", accountId: ACCOUNT },
		],
		[
			JUNK_MAILBOX,
			{ mailboxId: JUNK_MAILBOX, fullPath: "Junk", accountId: ACCOUNT },
		],
	]);

	const messageService = {
		get: async (id: string | string[]) => {
			if (Array.isArray(id)) {
				return id.map((i) => messages.get(i)).filter(Boolean);
			}
			const m = messages.get(id);
			if (!m) throw new Error(`no message ${id}`);
			return m;
		},
		describe: async (id: string) => {
			const m = messages.get(id);
			if (!m) throw new Error(`no message ${id}`);
			return {
				message: [m],
				messageFlag: [],
				envelope: [],
				messageReference: [],
				envelopeAddress: [
					{
						envelopeAddressId: "ea-1",
						messageId: id,
						addressId: ADDRESS_ID,
						normalizedEmail: fromEmail,
						addressRole: AddressRole.From,
						addressOrder: 0,
					},
				],
				bodyPart: [],
				bodyPartParameter: [],
				rawMessageStorage: [],
				bodyPartStorage: [],
				bodyPartContent: [],
			};
		},
		update: async (id: string, patch: Record<string, unknown>) => {
			const m = messages.get(id);
			if (m) Object.assign(m, patch);
			return m;
		},
		updateForMove: async (id: string, patch: Record<string, unknown>) => {
			const m = messages.get(id);
			if (m) Object.assign(m, patch);
			return m;
		},
		clearSpamReport: async (id: string) => {
			const m = messages.get(id);
			if (m) delete m.spamReport;
			return m;
		},
	} as unknown as IMessageRepository;

	const addressService = {
		mergeFlags: async (
			_accountConfigId: string,
			addressId: string,
			patch: Record<string, unknown>,
		) => {
			const entry = addresses.get(addressId);
			if (!entry) throw new Error(`no address ${addressId}`);
			const next = { ...entry.flags } as Record<string, unknown>;
			for (const [key, value] of Object.entries(patch)) {
				if (value === undefined) continue;
				if (value === null) {
					delete next[key];
					continue;
				}
				next[key] = value;
			}
			entry.flags = next as AddressFlags;
			return { addressId, flags: entry.flags };
		},
	} as unknown as IAddressRepository;

	const accountService = {
		get: async () => ({ accountId: ACCOUNT, email: ACCOUNT_EMAIL }),
	} as unknown as IAccountRepository;

	const mailboxSpecialUseService = {
		findJunkMailbox: async () => ({
			mailboxId: JUNK_MAILBOX,
			fullPath: "Junk",
		}),
		findTrashMailbox: async () => null,
	} as unknown as IMailboxSpecialUseRepository;

	const mailboxService = {
		get: async (_acc: string, id: string | string[]) => {
			if (Array.isArray(id)) {
				return id.map((i) => mailboxes.get(i)).filter(Boolean);
			}
			return mailboxes.get(id);
		},
	} as unknown as IMailboxRepository;

	const threadMessageService = {
		getByMessageId: async (_cfg: string, messageId: string) => {
			const row = threadRows.find((r) => r.messageId === messageId);
			if (!row) throw new Error(`no thread message ${messageId}`);
			return row;
		},
		update: async (
			_cfg: string,
			threadMessageId: string,
			patch: Record<string, unknown>,
		) => {
			const row = threadRows.find((r) => r.threadMessageId === threadMessageId);
			if (row) Object.assign(row, patch);
			return row;
		},
	} as unknown as IThreadMessageRepository;

	const sent: unknown[] = [];
	const sqsImpl = {
		send: async (command: unknown) => {
			sent.push(command);
			return {};
		},
	};

	const messageMoveService = new MessageMoveService({
		messageService,
		mailboxService,
		mailboxSpecialUseService,
		threadMessageService,
		sqsQueueUrl: "http://localhost:9324/000000000000/message-mgmt",
	});
	(
		messageMoveService as unknown as {
			sqs: { send: (c: unknown) => Promise<unknown> };
		}
	).sqs = sqsImpl;

	const markerPuts: Array<Record<string, unknown>> = [];
	const markerService: IMessageFlagPushRepository = {
		put: async (input: Record<string, unknown>) => {
			markerPuts.push(input);
			return {
				...input,
				state: "pending",
				createdAt: 1,
				updatedAt: 1,
			} as never;
		},
		find: async () => null,
		updateState: async () => ({}) as never,
		delete: async () => {},
		listByAccountId: async () => [],
		listByMailboxId: async () => [],
	};

	const flagPushService = new FlagPushService({
		markerService,
		sqsQueueUrl: "http://localhost:9324/000000000000/flag-push",
	});
	(
		flagPushService as unknown as {
			sqs: { send: (c: unknown) => Promise<unknown> };
		}
	).sqs = sqsImpl;

	const service = new SpamReportService({
		messageService,
		addressService,
		accountService,
		mailboxSpecialUseService,
		messageMoveService,
		flagPushService,
	});

	return { service, messages, addresses, sent, sqsImpl, markerPuts };
};

const moveEvents = (sent: unknown[]) =>
	sent.filter(
		(cmd) =>
			JSON.parse((cmd as { input: { MessageBody: string } }).input.MessageBody)
				.type === "MESSAGE_MOVE",
	);

describe("SpamReportService.reportSpam", () => {
	it("sets the blocked flag and enqueues the move to Junk", async () => {
		const { service, messages, addresses, sent, markerPuts } = buildWorld();

		await service.reportSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
			setBy: "user-1",
		});

		const address = addresses.get(ADDRESS_ID);
		assert.equal(address?.flags.blocked?.value, true);
		assert.equal(address?.flags.blocked?.setBy, "user-1");

		const message = messages.get(MESSAGE_ID);
		assert.equal(message?.mailboxId, JUNK_MAILBOX);
		assert.equal(moveEvents(sent).length, 1);

		assert.equal(markerPuts.length, 1);
		assert.equal(markerPuts[0].flagName, "$Junk");
		assert.equal(markerPuts[0].operation, "add");

		assert.ok(message !== undefined);
		const spamReport = message.spamReport as { reportedAt: number };
		assert.ok(spamReport.reportedAt > 0);
	});

	it("leaves the blocked flag in place when the move fails", async () => {
		const world = buildWorld();
		world.sqsImpl.send = async () => {
			throw new Error("SQS unavailable");
		};

		await assert.rejects(
			() =>
				world.service.reportSpam({
					accountConfigId: ACCOUNT_CONFIG,
					accountId: ACCOUNT,
					messageId: MESSAGE_ID,
				}),
			/SQS unavailable/,
		);

		const address = world.addresses.get(ADDRESS_ID);
		assert.equal(address?.flags.blocked?.value, true);
	});

	it("is idempotent under a double press", async () => {
		const { service, sent } = buildWorld();

		await service.reportSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
		});
		await service.reportSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
		});

		// The second call's move is a no-op: MessageMoveService.moveMessage sees
		// the local mailboxId already equals Junk and skips without enqueueing.
		assert.equal(moveEvents(sent).length, 1);
	});

	it("moves the message but writes no sender block when the message is forged from the account's own address", async () => {
		const { service, messages, addresses, sent } = buildWorld({
			fromEmail: ACCOUNT_EMAIL,
		});

		await service.reportSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
		});

		const address = addresses.get(ADDRESS_ID);
		assert.equal(address?.flags.blocked, undefined);

		const message = messages.get(MESSAGE_ID);
		assert.equal(message?.mailboxId, JUNK_MAILBOX);
		assert.equal(moveEvents(sent).length, 1);
		assert.ok(message !== undefined);
		assert.ok((message.spamReport as { reportedAt: number }).reportedAt > 0);
	});
});

describe("SpamReportService.notSpam", () => {
	it("restores the original mailbox and clears the flag without setting trust", async () => {
		const { service, messages, addresses } = buildWorld();

		await service.reportSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
		});
		await service.notSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
		});

		const message = messages.get(MESSAGE_ID);
		assert.equal(message?.mailboxId, INBOX_MAILBOX);
		assert.equal(message?.spamReport, undefined);

		const address = addresses.get(ADDRESS_ID);
		assert.equal(address?.flags.blocked, undefined);
		assert.equal(address?.flags.wellknown, undefined);
		assert.equal(address?.flags.trusted, undefined);
		assert.equal(address?.flags.vip, undefined);
	});

	it("clears the block and provenance without a 500 when the message never actually moved (same-mailbox no-op)", async () => {
		// report-spam pressed on a message the provider's filter already placed
		// in Junk: MessageMoveService.moveMessage's same-mailbox guard skips, so
		// originalMailboxId is never set.
		const { service, messages, addresses } = buildWorld({
			startMailbox: JUNK_MAILBOX,
		});

		await service.reportSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
		});
		await service.notSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
		});

		const message = messages.get(MESSAGE_ID);
		assert.equal(message?.mailboxId, JUNK_MAILBOX, "left where it is");
		assert.equal(message?.spamReport, undefined);

		const address = addresses.get(ADDRESS_ID);
		assert.equal(address?.flags.blocked, undefined);
	});

	it("repairs local state instead of enqueuing a second move when the original move failed asynchronously", async () => {
		const { service, messages, addresses, sent } = buildWorld();

		await service.reportSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
		});

		// Simulate the imap-worker's MESSAGE_MOVE handler exhausting its
		// retries: the message never actually reached Junk on the server, but
		// the local optimistic write (mailboxId=Junk) was never reverted.
		const message = messages.get(MESSAGE_ID);
		assert.ok(message !== undefined);
		message.syncStatus = "failed";

		await service.notSpam({
			accountConfigId: ACCOUNT_CONFIG,
			accountId: ACCOUNT,
			messageId: MESSAGE_ID,
		});

		assert.equal(
			moveEvents(sent).length,
			1,
			"no second move enqueued for a message that never left INBOX",
		);
		assert.equal(message.mailboxId, INBOX_MAILBOX);
		assert.equal(message.syncStatus, "synced");
		assert.equal(message.spamReport, undefined);

		const address = addresses.get(ADDRESS_ID);
		assert.equal(address?.flags.blocked, undefined);
	});
});
