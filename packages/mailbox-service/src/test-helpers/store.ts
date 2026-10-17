import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import type {
	SendMessageBatchCommand,
	SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { SQSClient } from "@aws-sdk/client-sqs";
import type {
	AccountItem,
	CreateMessageInput,
	CreateThreadMessageInput,
	MailboxItem,
	MailboxSpecialUseValue,
	MessageItem,
	ThreadMessageItem,
} from "@remit/data-ports";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import {
	AccountConfigRepo,
	AccountRepo,
	AccountSettingRepo,
	AddressRepo,
	CalendarCollectionRepo,
	CalendarSuggestionRepo,
	DrizzleCalendarUnitOfWork,
	DrizzleEnvelopeRepository,
	DrizzleMessageFlagRepository,
	DrizzleMessageRepository,
	DrizzleThreadMessageRepository,
	DrizzleUnitOfWork,
	FilterAnchorRepo,
	FilterRepo,
	LabelRepo,
	MailboxRepo,
	MailboxSpecialUseRepo,
	MessageFlagPushRepo,
	MessageLabelRepo,
	MessagePlacementMoveRepo,
	OutboxAttachmentRepo,
	OutboxMessageRepo,
	QuarantineRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteStore } from "@remit/drizzle-service/test-sqlite";
import type { StorageService } from "@remit/storage-service";
import { createFilesystemStorageService } from "@remit/storage-service/filesystem";
import { MessageSyncService } from "../message-sync.js";
import type { FakeImapServer } from "./fake-imap.js";

export const openStore = () => {
	const { db, close } = createShippedSqliteStore();
	const handle = db as never;
	return {
		accountConfig: new AccountConfigRepo(handle),
		account: new AccountRepo(handle),
		accountSetting: new AccountSettingRepo(handle),
		address: new AddressRepo(handle),
		mailbox: new MailboxRepo(handle),
		specialUse: new MailboxSpecialUseRepo(handle),
		message: new DrizzleMessageRepository(db),
		messageFlag: new DrizzleMessageFlagRepository(db),
		threadMessage: new DrizzleThreadMessageRepository(handle),
		envelope: new DrizzleEnvelopeRepository(db),
		quarantine: new QuarantineRepo(handle),
		placementMove: new MessagePlacementMoveRepo(handle),
		flagPush: new MessageFlagPushRepo(handle),
		filter: new FilterRepo(handle),
		filterAnchor: new FilterAnchorRepo(handle),
		label: new LabelRepo(handle),
		messageLabel: new MessageLabelRepo(handle),
		outboxMessage: new OutboxMessageRepo(handle),
		outboxAttachment: new OutboxAttachmentRepo(handle),
		calendarCollection: new CalendarCollectionRepo(handle),
		calendarSuggestion: new CalendarSuggestionRepo(handle),
		calendarUnitOfWork: new DrizzleCalendarUnitOfWork(handle),
		unitOfWork: new DrizzleUnitOfWork(db),
		close,
	};
};

export type Store = ReturnType<typeof openStore>;

export const scratchStorage = (): StorageService =>
	createFilesystemStorageService(mkdtempSync(join(tmpdir(), "mbx-store-")), {
		origin: "https://reader.test",
		signingSecret: "test-signing-secret",
	});

/** Storage whose root is a plain file, so every write fails as a full disk would. */
export const brokenStorage = (): StorageService => {
	const root = join(mkdtempSync(join(tmpdir(), "mbx-broken-")), "root");
	writeFileSync(root, "");
	return createFilesystemStorageService(root);
};

export const seedAccount = async (
	store: Store,
	overrides: Partial<AccountItem> = {},
): Promise<AccountItem> => {
	const config = await store.accountConfig.create({
		accountConfigId: overrides.accountConfigId,
		userId: "user-1",
		name: "Me",
	});
	return store.account.create({
		username: "me@example.com",
		email: "me@example.com",
		authType: AccountAuthType.Password,
		passwordHash: '{"ciphertext":"x"}',
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
		...overrides,
		accountConfigId: config.accountConfigId,
	});
};

export const seedMailbox = async (
	store: Store,
	account: Pick<AccountItem, "accountId">,
	fullPath: string,
	options: {
		specialUse?: MailboxSpecialUseValue;
		overrides?: Partial<MailboxItem>;
	} = {},
): Promise<MailboxItem> => {
	const created = await store.mailbox.create({
		accountId: account.accountId,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath,
		uidValidity: 7,
		uidNext: 1,
		highestModseq: "0",
		messageCount: 0,
		unseenCount: 0,
		deletedCount: 0,
		totalSize: 0,
		lastSyncUid: 0,
		highWaterMarkUid: 0,
		lastMessageSyncAt: 0,
		...(options.specialUse ? { specialUse: [options.specialUse] } : {}),
		...options.overrides,
	});
	if (created.outcome !== "Created") {
		throw new Error(`${fullPath} already exists`);
	}
	if (options.specialUse) {
		await store.specialUse.create(
			created.mailbox.mailboxId,
			options.specialUse,
		);
	}
	return created.mailbox;
};

export interface SeededMessage {
	message: MessageItem;
	threadMessage: ThreadMessageItem;
}

export const seedMessage = async (
	store: Store,
	account: Pick<AccountItem, "accountConfigId">,
	mailbox: Pick<MailboxItem, "mailboxId">,
	uid: number,
	overrides: {
		message?: Partial<CreateMessageInput>;
		threadMessage?: Partial<CreateThreadMessageInput>;
	} = {},
): Promise<SeededMessage> => {
	const messageId = overrides.message?.messageId ?? randomUUID();
	const message = await store.message.create({
		messageId,
		mailboxId: mailbox.mailboxId,
		uid,
		sequenceNumber: uid,
		rfc822Size: 100,
		internalDate: 1_700_000_000_000 + uid,
		envelopeId: randomUUID(),
		rootBodyPartId: randomUUID(),
		status: "active",
		syncStatus: "synced",
		...overrides.message,
	});
	const threadMessage = await store.threadMessage.create({
		accountConfigId: account.accountConfigId,
		threadId: messageId,
		messageId,
		mailboxId: message.mailboxId,
		uid: message.uid,
		referenceOrder: 0,
		internalDate: message.internalDate,
		sentDate: message.internalDate,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
		...overrides.threadMessage,
	});
	return { message, threadMessage };
};

export interface QueuedEvent {
	queueUrl: string;
	body: Record<string, unknown>;
}

export const captureQueue = (): QueuedEvent[] => {
	const sent: QueuedEvent[] = [];
	mock.method(
		SQSClient.prototype,
		"send",
		async (command: SendMessageCommand | SendMessageBatchCommand) => {
			const queueUrl = command.input.QueueUrl ?? "";
			const bodies =
				"Entries" in command.input
					? (command.input.Entries ?? []).map((entry) => entry.MessageBody)
					: [command.input.MessageBody];
			for (const body of bodies) {
				sent.push({ queueUrl, body: JSON.parse(body ?? "{}") });
			}
			return {};
		},
	);
	return sent;
};

export const silentLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};

export const syncFolder = async (
	store: Store,
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	mailbox: Pick<MailboxItem, "mailboxId">,
	imap: FakeImapServer,
): Promise<string[]> => {
	const connection = imap.connect();
	const service = new MessageSyncService(
		{ getConnection: () => connection, close: async () => {} },
		store.mailbox,
		store.specialUse,
		store.message,
		store.envelope,
		store.address,
		store.threadMessage,
		silentLog,
		store.unitOfWork,
		store.flagPush,
		store.messageFlag,
	);
	const synced: string[] = [];
	for (;;) {
		const result = await service.syncMessages(
			mailbox.mailboxId,
			account.accountId,
			account.accountConfigId,
		);
		synced.push(...result.syncedMessageIds);
		if (!result.hasMore) return synced;
	}
};

export const messageAtUid = async (
	store: Store,
	mailbox: Pick<MailboxItem, "mailboxId">,
	uid: number,
): Promise<MessageItem> => {
	const found = (await store.message.listAllByMailbox(mailbox.mailboxId)).find(
		(message) => message.uid === uid,
	);
	if (!found) throw new Error(`no message at uid ${uid}`);
	return found;
};

export const arriveAt = async (
	store: Store,
	imap: FakeImapServer,
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	mailbox: Pick<MailboxItem, "mailboxId" | "fullPath">,
	raw: Buffer,
): Promise<string> => {
	imap.folder(mailbox.fullPath);
	const uid = imap.deliver(mailbox.fullPath, raw);
	await syncFolder(store, account, mailbox, imap);
	return (await messageAtUid(store, mailbox, uid)).messageId;
};

export const storeBody = async (
	store: Store,
	storage: StorageService,
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	messageId: string,
	raw: Buffer,
): Promise<void> => {
	const ref = await storage.storeMessageBody({
		accountConfigId: account.accountConfigId,
		accountId: account.accountId,
		messageId,
		content: raw,
	});
	await store.message.update(messageId, { bodyStorageKey: ref.uri });
};

/**
 * Another writer landing between a service's read and its write: `action` runs,
 * for real, the next time `method` is called on `target`, and the call then
 * proceeds as normal.
 */
export const beforeNext = <T extends object, K extends keyof T>(
	target: T,
	method: K,
	action: () => Promise<unknown>,
): void => {
	const original = target[method] as unknown as (...args: unknown[]) => unknown;
	let pending = true;
	target[method] = (async (...args: unknown[]) => {
		if (pending) {
			pending = false;
			await action();
		}
		return original.apply(target, args);
	}) as T[K];
};
