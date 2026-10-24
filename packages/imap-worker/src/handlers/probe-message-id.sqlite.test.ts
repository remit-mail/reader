import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { MailboxItem } from "@remit/data-ports";
import {
	AccountAuthType,
	ConnectionState,
	MailboxCursorState,
} from "@remit/domain-enums";
import {
	AccountRepo,
	AddressRepo,
	DrizzleEnvelopeRepository,
	DrizzleMessageRepository,
	DrizzleThreadMessageRepository,
	MailboxRepo,
	MailboxSpecialUseRepo,
	SearchIndex,
	SyncWarningRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import {
	type IImapConnection,
	type ManagedConnectionFactory,
	MessageMoveService,
	MessageSyncService,
	SyncWarningService,
} from "@remit/mailbox-service";
import type { ImapMessage } from "@remit/mailbox-service/types";
import { probeableMessageIdHeader } from "./probe-message-id.js";

const ACCOUNT_CONFIG_ID = "cfg-msgid";
const UID_VALIDITY = 7;

const inboxHolding = (messageIdHeader: string): ImapMessage => ({
	uid: 3,
	seq: 1,
	flags: [],
	internalDate: new Date(0),
	size: 100,
	envelope: {
		date: new Date(0).toISOString(),
		messageId: messageIdHeader,
		subject: "Quarterly report",
		from: [{ name: "Sender", mailbox: "sender", host: "example.com" }],
		sender: [],
		replyTo: [],
		to: [],
		cc: [],
		bcc: [],
		inReplyTo: "",
	},
});

const serverWithInbox = (message: ImapMessage): IImapConnection =>
	({
		openBox: async (path: string) => ({
			name: path,
			readOnly: false,
			uidvalidity: UID_VALIDITY,
			uidnext: message.uid + 1,
			flags: [],
			permFlags: [],
			persistentUIDs: true,
			messages: { total: 1, new: 0 },
			newKeywords: false,
		}),
		getMailboxStatus: async () => ({
			messages: 1,
			recent: 0,
			unseen: 0,
			uidNext: message.uid + 1,
			uidValidity: UID_VALIDITY,
			highestModseq: "0",
			deletedCount: 0,
		}),
		supportsCondstore: () => false,
		search: async () => [message.uid],
		fetchMessages: async () => [message],
	}) as unknown as IImapConnection;

describe("the Message-ID the move, delete and copy probes ask with", () => {
	let close: () => void;
	let db: never;
	let accountId: string;
	let mailboxes: MailboxRepo;
	let messages: DrizzleMessageRepository;
	let threadMessages: DrizzleThreadMessageRepository;

	const createMailbox = async (fullPath: string): Promise<MailboxItem> => {
		const created = await mailboxes.create({
			accountId,
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath,
			uidValidity: UID_VALIDITY,
			uidNext: 1,
			highestModseq: "0",
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
			cursorState: MailboxCursorState.normal,
		} as Parameters<MailboxRepo["create"]>[0]);
		if (created.outcome !== "Created") throw new Error(`${fullPath} taken`);
		return created.mailbox;
	};

	const syncInbox = async (messageIdHeader: string): Promise<string> => {
		const inbox = await createMailbox("INBOX");
		const connection = serverWithInbox(inboxHolding(messageIdHeader));
		const factory: ManagedConnectionFactory = {
			getConnection: () => connection,
			close: async () => {},
		};
		await new MessageSyncService(
			factory,
			mailboxes,
			new MailboxSpecialUseRepo(db, db),
			messages,
			new DrizzleEnvelopeRepository(db),
			new AddressRepo(db),
			threadMessages,
			new SyncWarningService(new SyncWarningRepo(db)),
		).syncMessages(inbox.mailboxId, accountId, ACCOUNT_CONFIG_ID);
		const [synced] = await messages.listAllByMailbox(inbox.mailboxId);
		if (!synced) throw new Error("sync stored no message");
		return synced.messageId;
	};

	const probeable = (messageId: string): Promise<string | undefined> =>
		probeableMessageIdHeader(threadMessages, ACCOUNT_CONFIG_ID, messageId);

	beforeEach(async () => {
		const store = createShippedSqliteDb();
		close = store.close;
		db = store.db as never;
		mailboxes = new MailboxRepo(db, new SearchIndex(db, db));
		messages = new DrizzleMessageRepository(db, new SearchIndex(db, db));
		threadMessages = new DrizzleThreadMessageRepository(
			db,
			new SearchIndex(db, db),
		);
		const account = await new AccountRepo(db, db).create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			username: "person@example.com",
			email: "person@example.com",
			authType: AccountAuthType.Password,
			passwordHash: '{"ciphertext":"x"}',
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: ConnectionState.Authenticated,
		});
		accountId = account.accountId;
	});

	afterEach(() => {
		mock.restoreAll();
		close();
	});

	it("reads the Message-ID a real sync stored", async () => {
		const messageId = await syncInbox("<report@example.com>");

		assert.equal(await probeable(messageId), "<report@example.com>");
	});

	it("reads the source's Message-ID for a copy", async () => {
		const sourceId = await syncInbox("<report@example.com>");
		const archive = await createMailbox("Archive");
		mock.method(SQSClient.prototype, "send", async () => ({}));

		const copyId = await new MessageMoveService({
			messageService: messages,
			mailboxService: mailboxes,
			mailboxSpecialUseService: new MailboxSpecialUseRepo(db, db),
			threadMessageService: threadMessages,
			addressService: new AddressRepo(db),
			sqsQueueUrl: "https://queue.test/messages",
		}).copyMessage(ACCOUNT_CONFIG_ID, sourceId, archive.mailboxId, accountId);

		assert.notEqual(copyId, sourceId);
		assert.equal(await probeable(copyId), "<report@example.com>");
	});

	it("answers unprobeable for a bounce whose Message-ID is <>", async () => {
		const messageId = await syncInbox("<>");

		assert.equal(await probeable(messageId), undefined);
	});
});
