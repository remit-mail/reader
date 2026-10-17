import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SendMessageBatchCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
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
import { applyShippedMigrations } from "@remit/drizzle-service/test-sqlite";
import type { Logger } from "@remit/logger-lambda";
import { serializeEncryptedPayload } from "@remit/secrets-service";
import { mockClient } from "aws-sdk-client-mock";
import Database from "better-sqlite3";
import { emitEvent } from "../emit.js";
import { withOAuthLifecycle } from "../with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "../with-oauth-lifecycle-deps.js";
import { FakeImapServer } from "./test-imap-server.js";

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

const sqs = mockClient(SQSClient);

/**
 * One SQLite store per test file, over the shipped migrations, composed by the
 * backend's own SQLite composition root over filesystem storage — every
 * repository and service a handler reaches is the one a self-host process runs. Each `world()` is a
 * fresh account on it, with its own in-memory mail server at the IMAP port.
 */
export const openStore = async (): Promise<{
	client: RemitClient;
	world: () => Promise<World>;
}> => {
	const directory = mkdtempSync(join(tmpdir(), "imap-worker-world-"));
	const path = join(directory, "remit.db");
	const sqlite = new Database(path);
	applyShippedMigrations(sqlite);
	sqlite.close();
	process.env.SQLITE_DB_PATH = path;
	delete process.env.S3_BUCKET_NAME;
	process.env.STORAGE_LOCAL_PATH = join(directory, "storage");
	process.env.BETTER_AUTH_URL = "https://mail.example.com";
	process.env.BETTER_AUTH_SECRET = "a-signing-secret-of-at-least-32-characters";
	_resetForTest();
	const client = await getClient();
	setClient(client);
	return { client, world: () => createWorld(client) };
};

export interface World {
	client: RemitClient;
	imap: FakeImapServer;
	account: AccountItem;
	logs: LogLine[];
	log: Logger;
	folder: (path: string, options?: FolderOptions) => Promise<MailboxItem>;
	message: (
		mailbox: MailboxItem,
		options?: { messageIdHeader?: string; uid?: number },
	) => Promise<SeededMessage>;
	row: (messageId: string) => Promise<MessageItem | undefined>;
	threadRows: (
		messageId: string,
	) => Promise<Array<{ mailboxId: string; uid?: number; isDeleted: boolean }>>;
	queued: () => Array<Record<string, unknown>>;
	draft: (
		attachment?: Buffer,
	) => Promise<{ outbox: OutboxMessageItem; attachmentId?: string }>;
	deps: () => {
		getClient: typeof getClient;
		buildLifecycleDeps: typeof buildLifecycleDeps;
		withOAuthLifecycle: typeof withOAuthLifecycle;
		createConnectionScope: () => {
			getConnection: () => Promise<ReturnType<FakeImapServer["connection"]>>;
			disconnect: () => Promise<void>;
		};
		emitEvent: typeof emitEvent;
	};
}

const createWorld = async (client: RemitClient): Promise<World> => {
	sqs.reset();
	sqs.on(SendMessageCommand).resolves({});
	sqs.on(SendMessageBatchCommand).resolves({ Failed: [] });

	const imap = new FakeImapServer();
	const logs: LogLine[] = [];
	const accountConfigId = `cfg-${randomUUID()}`;
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
	} as Parameters<RemitClient["account"]["create"]>[0]);

	const folder = async (
		path: string,
		options: FolderOptions = {},
	): Promise<MailboxItem> => {
		const uidValidity = options.uidValidity ?? 1;
		imap.addFolder(path, uidValidity);
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
		} as Parameters<RemitClient["mailbox"]["create"]>[0]);
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

	const message = async (
		mailbox: MailboxItem,
		options: { messageIdHeader?: string; uid?: number } = {},
	): Promise<SeededMessage> => {
		const messageIdHeader =
			options.messageIdHeader ?? `<${randomUUID()}@example.com>`;
		const uid = imap.deliver(mailbox.fullPath, messageIdHeader, options.uid);
		const messageId = randomUUID();
		await client.message.create({
			messageId,
			mailboxId: mailbox.mailboxId,
			uid,
			sequenceNumber: 1,
			rfc822Size: 10,
			internalDate: 1_700_000_000_000,
			messageIdHeader,
			envelopeId: randomUUID(),
			rootBodyPartId: randomUUID(),
			status: "active",
			syncStatus: "synced",
		} as Parameters<RemitClient["message"]["create"]>[0]);
		const threadMessage = await client.threadMessage.create({
			accountConfigId,
			threadId: `thread-${messageId}`,
			messageId,
			mailboxId: mailbox.mailboxId,
			uid,
			referenceOrder: 0,
			internalDate: 1_700_000_000_000,
			sentDate: 1_700_000_000_000,
			isRead: false,
			isDeleted: false,
			hasAttachment: false,
			hasStars: false,
		} as Parameters<RemitClient["threadMessage"]["create"]>[0]);
		return {
			messageId,
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

	const queued = (): Array<Record<string, unknown>> => [
		...sqs
			.commandCalls(SendMessageCommand)
			.map((call) => JSON.parse(call.args[0].input.MessageBody ?? "{}")),
		...sqs
			.commandCalls(SendMessageBatchCommand)
			.flatMap((call) =>
				(call.args[0].input.Entries ?? []).map((entry) =>
					JSON.parse(entry.MessageBody ?? "{}"),
				),
			),
	];

	/** A draft composed through the service the API calls, with an uploaded file. */
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

	const deps = () => ({
		getClient,
		buildLifecycleDeps,
		withOAuthLifecycle,
		createConnectionScope: () => {
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
		},
		emitEvent,
	});

	return {
		client,
		imap,
		account,
		logs,
		log: capturingLogger(logs),
		folder,
		message,
		row,
		threadRows,
		queued,
		draft,
		deps,
	};
};
