import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
	MailboxCursorState,
	MailboxSpecialUse,
} from "@remit/domain-enums";
import {
	BETTER_SQLITE3_LIMITS,
	createSqliteRepositories,
	type MailboxRepo,
	messageObjectsInMemory,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { buildThreadMessageTrashUpdate } from "@remit/mailbox-service";
import type { Context } from "openapi-backend";
import { testApiConfig } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
import type { HandlerContext } from "../types.js";
import { ThreadOperations } from "./thread.js";

const SUB = "cognito-sub-1497";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const NOW = 1_700_000_000_000;

type Repositories = ReturnType<typeof createSqliteRepositories>;

let repos: Repositories;
let close: () => void;

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	repos = createSqliteRepositories(
		{ app: store.db, mail: store.db, search: store.db },
		BETTER_SQLITE3_LIMITS,
		messageObjectsInMemory(),
	);
});

afterEach(() => {
	close();
});

const handlerContext = (): HandlerContext => ({
	client: {
		account: repos.account,
		accountSetting: repos.accountSetting,
		mailbox: repos.mailbox,
		mailboxSpecialUse: repos.mailboxSpecialUse,
		address: repos.address,
		message: repos.message,
		threadMessage: repos.threadMessage,
		label: repos.label,
		messageLabel: repos.messageLabel,
	} as unknown as RemitClient,
	config: testApiConfig(),
	identity: {
		kind: "user",
		accountConfigId: ACCOUNT_CONFIG_ID,
		sub: SUB,
		email: "caller@example.com",
	},
});

const createFolder = async (
	accountId: string,
	fullPath: string,
): Promise<string> => {
	const created = await repos.mailbox.create({
		accountId,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath,
		uidValidity: 1,
		uidNext: 2,
		highestModseq: "0",
		messageCount: 1,
		unseenCount: 1,
		deletedCount: 0,
		totalSize: 10,
		lastSyncUid: 1,
		highWaterMarkUid: 1,
		lastMessageSyncAt: NOW,
		cursorState: MailboxCursorState.normal,
	} as Parameters<MailboxRepo["create"]>[0]);
	if (created.outcome !== "Created") throw new Error(`${fullPath} taken`);
	return created.mailbox.mailboxId;
};

const seedAccount = async (): Promise<{
	inboxId: string;
	trashId: string;
}> => {
	const account = await repos.account.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		username: "trash@example.com",
		email: "trash@example.com",
		authType: AccountAuthType.OauthMicrosoft,
		syncedServices: [AccountService.Mail],
		imapHost: "outlook.office365.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
	});
	const inboxId = await createFolder(account.accountId, "INBOX");
	const trashId = await createFolder(account.accountId, "Trash");
	await repos.mailboxSpecialUse.create(trashId, MailboxSpecialUse.Trash);
	return { inboxId, trashId };
};

const seedInboxThread = async (
	inboxId: string,
	subject: string,
): Promise<{ threadId: string; threadMessageId: string }> => {
	const messageId = randomUUID();
	await repos.message.create({
		messageId,
		mailboxId: inboxId,
		uid: 1,
		sequenceNumber: 1,
		rfc822Size: 10,
		internalDate: NOW,
		status: "active",
		syncStatus: "synced",
	});
	const threadId = randomUUID();
	const row = await repos.threadMessage.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		threadId,
		messageId,
		mailboxId: inboxId,
		uid: 1,
		referenceOrder: 0,
		internalDate: NOW,
		sentDate: NOW,
		subject,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
	});
	return { threadId, threadMessageId: row.threadMessageId };
};

const settleTrashMove = async (
	threadMessageId: string,
	trashId: string,
): Promise<void> => {
	const row = await repos.threadMessage.get(ACCOUNT_CONFIG_ID, threadMessageId);
	const args = buildThreadMessageTrashUpdate(row, 7, trashId);
	await repos.threadMessage.update(
		ACCOUNT_CONFIG_ID,
		threadMessageId,
		args.set,
		{ composites: args.composites },
	);
};

const listThreadIds = async (mailboxId: string): Promise<string[]> => {
	const response = (await ThreadOperations.ThreadOperations_listThreads(
		{ request: { params: { mailboxId }, query: {} } } as unknown as Context,
		handlerContext(),
	)) as { items: { threadId: string }[] };
	return response.items.map((item) => item.threadId);
};

const searchThreadIds = async (mailboxId: string): Promise<string[]> => {
	const response = (await ThreadOperations.ThreadOperations_searchThreads(
		{
			request: { params: { mailboxId }, query: { unread: true } },
		} as unknown as Context,
		handlerContext(),
	)) as { items: { threadId: string }[] };
	return response.items.map((item) => item.threadId);
};

describe("the Trash folder listing (#1497)", () => {
	it("lists a thread trashed through reader", async () => {
		const { inboxId, trashId } = await seedAccount();
		const trashed = await seedInboxThread(inboxId, "thrown away");

		await settleTrashMove(trashed.threadMessageId, trashId);

		assert.deepEqual(await listThreadIds(trashId), [trashed.threadId]);
		assert.deepEqual(await listThreadIds(inboxId), []);
	});

	it("answers a filtered Trash listing with the trashed thread", async () => {
		const { inboxId, trashId } = await seedAccount();
		const trashed = await seedInboxThread(inboxId, "thrown away");

		await settleTrashMove(trashed.threadMessageId, trashId);

		assert.deepEqual(await searchThreadIds(trashId), [trashed.threadId]);
	});

	it("keeps hiding deleted rows in an ordinary mailbox", async () => {
		const { inboxId } = await seedAccount();
		const kept = await seedInboxThread(inboxId, "kept");
		const deleted = await seedInboxThread(inboxId, "marked deleted");
		const row = await repos.threadMessage.get(
			ACCOUNT_CONFIG_ID,
			deleted.threadMessageId,
		);
		await repos.threadMessage.update(
			ACCOUNT_CONFIG_ID,
			deleted.threadMessageId,
			{ isDeleted: true },
			{
				composites: {
					sentDate: row.sentDate,
					mailboxId: row.mailboxId,
					isRead: row.isRead,
					isDeleted: row.isDeleted,
					hasStars: row.hasStars,
					hasAttachment: row.hasAttachment,
				},
			},
		);

		assert.deepEqual(await listThreadIds(inboxId), [kept.threadId]);
		assert.deepEqual(await searchThreadIds(inboxId), [kept.threadId]);
	});
});
