import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	createSqliteRepositories,
	openSqliteDatabases,
} from "@remit/drizzle-service";
import { applyShippedMigrations } from "@remit/drizzle-service/test-sqlite";
import type { StorageService } from "@remit/storage-service";
import { createFilesystemStorageService } from "@remit/storage-service/filesystem";
import Database from "better-sqlite3";
import { MessageSyncService } from "../message-sync.js";
import { SyncWarningService } from "../sync-warning.js";
import type { FakeImapServer } from "./fake-imap.js";

export {
	failingQueue,
	type RecordedMessage,
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";

const UPLOAD_URLS = {
	origin: "https://reader.test",
	signingSecret: "test-signing-secret",
};

/**
 * The store the app opens: the committed migrations applied to a file, then
 * that file opened the way the app opens it — as the app, mail and search
 * database at once — with every repo the app composes.
 * Storage made from it lives in the same directory and goes with it.
 */
let migrated: string | undefined;

const migratedTemplate = (): string => {
	if (migrated) return migrated;
	const dir = mkdtempSync(join(tmpdir(), "mbx-template-"));
	const filename = join(dir, "template.sqlite");
	const migrating = new Database(filename);
	migrating.pragma("synchronous = OFF");
	applyShippedMigrations(migrating);
	migrating.close();
	process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
	migrated = filename;
	return filename;
};

export const openStore = async () => {
	const dir = mkdtempSync(join(tmpdir(), "mbx-store-"));
	const filename = join(dir, "store.sqlite");
	copyFileSync(migratedTemplate(), filename);
	const { close, ...databases } = await openSqliteDatabases({
		app: filename,
		mail: filename,
		search: filename,
	});
	let storages = 0;
	return {
		...createSqliteRepositories(databases),
		storage: (): StorageService =>
			createFilesystemStorageService(
				join(dir, `storage-${++storages}`),
				UPLOAD_URLS,
			),
		brokenStorage: (): StorageService => {
			const root = join(dir, `broken-${++storages}`);
			writeFileSync(root, "");
			return createFilesystemStorageService(root);
		},
		close: async () => {
			await close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
};

export type Store = Awaited<ReturnType<typeof openStore>>;

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
		await store.mailboxSpecialUse.create(
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
	const connection = imap.connection();
	const service = new MessageSyncService(
		{ getConnection: () => connection, close: async () => {} },
		store.mailbox,
		store.mailboxSpecialUse,
		store.message,
		store.envelope,
		store.address,
		store.threadMessage,
		new SyncWarningService(store.syncWarning),
		silentLog,
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
