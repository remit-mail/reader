import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	_resetForTest,
	getClient,
	type RemitClient,
	setClient,
} from "@remit/backend/client";
import type {
	AccountItem,
	MailboxItem,
	MailboxSpecialUseValue,
	MessageItem,
	OutboxMessageItem,
} from "@remit/data-ports";
import {
	AccountAuthType,
	ConnectionState,
	MailboxCursorState,
} from "@remit/domain-enums";
import { createShippedSqliteFiles } from "@remit/drizzle-service/test-sqlite";
import type { Logger } from "@remit/logger-lambda";
import type { ManagedConnectionFactory } from "@remit/mailbox-service";
import {
	eml,
	FakeImapServer,
} from "@remit/mailbox-service/test-helpers/fake-imap";
import {
	captureQueue,
	type QueueCapture,
} from "@remit/mailbox-service/test-helpers/test-queue";
import { serializeEncryptedPayload } from "@remit/secrets-service";
import type { createConnectionScopeWithCredentials } from "../connection-scope.js";
import { syncMessages } from "../handlers/sync-messages.js";

export interface LogLine {
	level: string;
	fields: Record<string, unknown>;
}

export const capturingLogger = (lines: LogLine[]): Logger => {
	const at =
		(level: string) =>
		(fields: Record<string, unknown>): void => {
			lines.push({ level, fields });
		};
	const log = {
		info: at("info"),
		warn: at("warn"),
		error: at("error"),
		debug: at("debug"),
		fatal: at("fatal"),
		trace: at("trace"),
		child: () => log,
	} as unknown as Logger;
	return log;
};

/** A message the way a correspondent sends one, naming it by its Message-ID. */
export const mail = (messageIdHeader: string): Buffer =>
	eml({
		"Message-ID": messageIdHeader,
		From: "Friend <friend@example.com>",
		To: "Person <person@example.com>",
		Date: "Tue, 14 Nov 2023 22:13:20 +0000",
		Subject: "test",
		"Content-Type": "text/plain; charset=utf-8",
	});

export interface FolderOptions {
	specialUse?: MailboxSpecialUseValue;
	uidValidity?: number;
	cursorState?: MailboxItem["cursorState"];
}

export interface SeededMessage {
	messageId: string;
	uid: number;
	messageIdHeader: string;
	threadMessageId: string;
}

/**
 * One SQLite store per test file, over the shipped migrations, composed by the
 * backend's own SQLite composition root over filesystem storage — every
 * repository and service a handler reaches is the one a self-host process
 * runs. Each `world()` is a fresh account on it, with its own in-memory mail
 * server at the IMAP port, and a message reaches the store the way mail does:
 * delivered to the server, then synced.
 */
export const openStore = async (): Promise<{
	client: RemitClient;
	world: (accountConfigId?: string) => Promise<World>;
	close: () => void;
}> => {
	const directory = mkdtempSync(join(tmpdir(), "imap-worker-world-"));
	createShippedSqliteFiles(directory);
	delete process.env.S3_BUCKET_NAME;
	process.env.STORAGE_LOCAL_PATH = join(directory, "storage");
	process.env.BETTER_AUTH_URL = "https://mail.example.com";
	process.env.BETTER_AUTH_SECRET = "a-signing-secret-of-at-least-32-characters";
	_resetForTest();
	const client = await getClient();
	setClient(client);
	return {
		client,
		world: (accountConfigId = `cfg-${randomUUID()}`) =>
			createWorld(client, accountConfigId),
		close: () => {
			_resetForTest();
			rmSync(directory, { recursive: true, force: true });
		},
	};
};

export interface World {
	client: RemitClient;
	imap: FakeImapServer;
	account: AccountItem;
	logs: LogLine[];
	log: Logger;
	folder: (path: string, options?: FolderOptions) => Promise<MailboxItem>;
	/** A folder of a second account on this world's account config. */
	siblingFolder: (path: string) => Promise<MailboxItem>;
	message: (
		mailbox: MailboxItem,
		options?: { messageIdHeader?: string },
	) => Promise<SeededMessage>;
	row: (messageId: string) => Promise<MessageItem | undefined>;
	threadRows: (
		messageId: string,
	) => Promise<Array<{ mailboxId: string; uid?: number; isDeleted: boolean }>>;
	queued: () => Array<Record<string, unknown>>;
	refuseSends: (error: Error | undefined) => void;
	queue: QueueCapture;
	draft: (
		attachment?: Buffer,
	) => Promise<{ outbox: OutboxMessageItem; attachmentId?: string }>;
	scope: typeof createConnectionScopeWithCredentials;
	connectionFactory: () => ManagedConnectionFactory;
}

const createWorld = async (
	client: RemitClient,
	accountConfigId: string,
): Promise<World> => {
	const queue = captureQueue();

	const imap = new FakeImapServer();
	const logs: LogLine[] = [];
	const password = await client.secrets.encrypt("app-password");
	const account = await client.account.create({
		accountConfigId,
		username: "person@example.com",
		email: "person@example.com",
		authType: AccountAuthType.Password,
		passwordHash: JSON.stringify(serializeEncryptedPayload(password)),
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
	});

	const folder = async (
		path: string,
		options: FolderOptions = {},
	): Promise<MailboxItem> => {
		const uidValidity = options.uidValidity ?? 1;
		imap.addFolder(path, { uidValidity });
		const created = await client.mailbox.create({
			accountId: account.accountId,
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath: path,
			uidValidity,
			uidNext: 1,
			highestModseq: "0",
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
			syncStatus: "synced",
		});
		if (created.outcome !== "Created") {
			throw new Error(`${path} could not be created: ${created.outcome}`);
		}
		const mailbox = created.mailbox;
		if (options.specialUse) {
			await client.mailboxSpecialUse.create(
				mailbox.mailboxId,
				options.specialUse,
			);
		}
		if (
			options.cursorState &&
			options.cursorState !== MailboxCursorState.normal
		) {
			await client.mailbox.update(account.accountId, mailbox.mailboxId, {
				cursorState: options.cursorState,
			});
			return client.mailbox.get(account.accountId, mailbox.mailboxId);
		}
		return mailbox;
	};

	const siblingFolder = async (path: string): Promise<MailboxItem> => {
		const sibling = await client.account.create({
			accountConfigId,
			username: "person-too@example.com",
			email: "person-too@example.com",
			authType: AccountAuthType.Password,
			passwordHash: JSON.stringify(serializeEncryptedPayload(password)),
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: ConnectionState.Authenticated,
		});
		const created = await client.mailbox.create({
			accountId: sibling.accountId,
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath: path,
			uidValidity: 1,
			uidNext: 1,
			highestModseq: "0",
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
			syncStatus: "synced",
		});
		if (created.outcome !== "Created") {
			throw new Error(`${path} could not be created: ${created.outcome}`);
		}
		return created.mailbox;
	};

	const message = async (
		mailbox: MailboxItem,
		options: { messageIdHeader?: string } = {},
	): Promise<SeededMessage> => {
		const messageIdHeader =
			options.messageIdHeader ?? `<${randomUUID()}@example.com>`;
		const uid = imap.deliver(mailbox.fullPath, mail(messageIdHeader));
		const baseline = {
			connections: imap.connections,
			commands: imap.log.length,
		};
		await syncMessages(
			{
				type: "SYNC_MESSAGES",
				eventId: randomUUID(),
				timestamp: Date.now(),
				accountId: account.accountId,
				mailboxId: mailbox.mailboxId,
			},
			capturingLogger([]),
			connectionFactory,
		);
		imap.connections = baseline.connections;
		imap.log.length = baseline.commands;
		const synced = (
			await client.message.listAllByMailbox(mailbox.mailboxId)
		).find((row) => row.uid === uid);
		if (!synced)
			throw new Error(`uid ${uid} in ${mailbox.fullPath} did not sync`);
		const [threadMessage] = await client.threadMessage.findAllByMessageId(
			accountConfigId,
			synced.messageId,
		);
		if (!threadMessage)
			throw new Error(`uid ${uid} synced without a listing row`);
		return {
			messageId: synced.messageId,
			uid,
			messageIdHeader,
			threadMessageId: threadMessage.threadMessageId,
		};
	};

	const row = async (messageId: string): Promise<MessageItem | undefined> =>
		(await client.message.get([messageId]))[0];

	const threadRows = async (messageId: string) =>
		(
			await client.threadMessage.findAllByMessageId(accountConfigId, messageId)
		).map((tm) => ({
			mailboxId: tm.mailboxId,
			uid: tm.uid,
			isDeleted: tm.isDeleted,
		}));

	const queued = (): Array<Record<string, unknown>> =>
		queue.sent.map((event) => event.body);

	const refuseSends = (error: Error | undefined): void => {
		queue.answer(async () => {
			if (error) throw error;
			return {};
		});
	};

	const draft = async (
		attachment?: Buffer,
	): Promise<{ outbox: OutboxMessageItem; attachmentId?: string }> => {
		const outbox = await client.outboxQueue.createDraft({
			accountId: account.accountId,
			accountConfigId,
			fromAddress: "person@example.com",
			fromName: "Person",
			toAddresses: ["friend@example.com"],
			subject: "Quarterly numbers",
			textBody: "See you Thursday.",
		});
		if (!attachment) return { outbox };
		const minted = await client.outboxAttachment.mint({
			accountConfigId,
			outboxMessageId: outbox.outboxMessageId,
			filename: "numbers.csv",
			contentType: "text/csv",
			sizeBytes: attachment.length,
		});
		if (minted.outcome !== "Minted") throw new Error("the upload was refused");
		const attachmentId = minted.reservation.outboxAttachmentId;
		await client.storage.storeOutboxAttachment({
			accountConfigId,
			accountId: account.accountId,
			outboxMessageId: outbox.outboxMessageId,
			outboxAttachmentId: attachmentId,
			content: attachment,
		});
		const completed = await client.outboxAttachment.complete({
			accountConfigId,
			outboxMessageId: outbox.outboxMessageId,
			outboxAttachmentId: attachmentId,
		});
		assert.equal(completed.outcome, "Completed");
		return { outbox, attachmentId };
	};

	const scope = () => {
		let open: ReturnType<FakeImapServer["connection"]> | undefined;
		return {
			getConnection: async () => {
				open ??= imap.connection();
				return open;
			},
			disconnect: async () => {
				open = undefined;
			},
		};
	};

	const connectionFactory = (): ManagedConnectionFactory => {
		let open: ReturnType<FakeImapServer["connection"]> | undefined;
		return {
			getConnection: () => {
				open ??= imap.connection();
				return open;
			},
			close: async () => {
				open = undefined;
			},
		};
	};

	return {
		client,
		imap,
		account,
		logs,
		log: capturingLogger(logs),
		folder,
		siblingFolder,
		message,
		row,
		threadRows,
		queued,
		refuseSends,
		queue,
		draft,
		scope,
		connectionFactory,
	};
};
