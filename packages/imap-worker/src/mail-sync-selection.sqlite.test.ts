import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "@remit/backend/client";
import type { AccountItem } from "@remit/data-ports";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
	MailboxCursorState,
} from "@remit/domain-enums";
import {
	AccountRepo,
	DrizzleMessageRepository,
	MailboxRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import type { Logger } from "@remit/logger-lambda";
import { syncMailboxes } from "./handlers/sync-mailboxes.js";
import {
	type SyncMessagesDeps,
	syncMessages,
} from "./handlers/sync-messages.js";
import { runSchedulerTick } from "./scheduler/run-tick.js";

const NOW = 1_700_000_000_000;

const silentLogger: Logger = (() => {
	const noop = () => {};
	const stub = {
		info: noop,
		warn: noop,
		error: noop,
		debug: noop,
		fatal: noop,
		trace: noop,
		child: () => stub,
	};
	return stub as unknown as Logger;
})();

let accounts: AccountRepo;
let mailboxes: MailboxRepo;
let messages: DrizzleMessageRepository;
let client: RemitClient;
let close: () => void;

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	accounts = new AccountRepo(store.db);
	mailboxes = new MailboxRepo(store.db);
	messages = new DrizzleMessageRepository(store.db as never);
	client = {
		account: accounts,
		mailbox: mailboxes,
		message: messages,
	} as unknown as RemitClient;
	setClient(client);
});

afterEach(() => {
	_resetForTest();
	close();
});

const seedSyncedAccount = async (): Promise<{
	account: AccountItem;
	mailboxId: string;
	messageId: string;
}> => {
	const account = await accounts.create({
		accountConfigId: "cfg-1181",
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
	const mailbox = await mailboxes.create({
		accountId: account.accountId,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath: "INBOX",
		uidValidity: 7,
		uidNext: 4,
		highestModseq: "42",
		messageCount: 1,
		unseenCount: 0,
		deletedCount: 0,
		totalSize: 10,
		lastSyncUid: 3,
		highWaterMarkUid: 3,
		lastMessageSyncAt: NOW,
		cursorState: MailboxCursorState.normal,
	} as Parameters<MailboxRepo["create"]>[0]);
	const messageId = randomUUID();
	await messages.create({
		messageId,
		mailboxId: mailbox.mailboxId,
		uid: 3,
		sequenceNumber: 1,
		rfc822Size: 10,
		internalDate: NOW,
		envelopeId: randomUUID(),
		rootBodyPartId: randomUUID(),
		status: "active",
		syncStatus: "synced",
	});
	return { account, mailboxId: mailbox.mailboxId, messageId };
};

const tick = async (): Promise<{ enqueued: number; accountIds: string[] }> => {
	const sent: SendMessageCommand[] = [];
	const sqsClient = {
		send: async (command: SendMessageCommand) => {
			sent.push(command);
			return {};
		},
	} as unknown as SQSClient;
	const result = await runSchedulerTick({
		accountService: accounts,
		sqsClient,
		queueUrl: "https://queue.test/mailboxes",
		log: silentLogger,
		tickIntervalMs: 60_000,
		offlineIntervalMs: 0,
		now: NOW,
	});
	return {
		enqueued: result.enqueued,
		accountIds: sent.map(
			(command) => JSON.parse(command.input.MessageBody ?? "{}").accountId,
		),
	};
};

const setServices = (
	accountId: string,
	syncedServices: AccountItem["syncedServices"],
) => accounts.update(accountId, { syncedServices });

describe("turning mail sync off and on again", () => {
	it("stops every mail sync entry point and keeps the stored mail", async () => {
		const { account, mailboxId, messageId } = await seedSyncedAccount();
		const storedMailboxes = await mailboxes.listAllByAccount(account.accountId);
		const storedMessage = await messages.get(messageId);

		await setServices(account.accountId, [AccountService.Calendar]);

		assert.deepEqual(await tick(), { enqueued: 0, accountIds: [] });

		await syncMailboxes(
			{
				type: "SYNC_MAILBOXES",
				eventId: "evt-mailboxes",
				timestamp: NOW,
				accountId: account.accountId,
			},
			silentLogger,
		);

		let lifecycleCalls = 0;
		const deps = {
			getClient: async () => client,
			buildLifecycleDeps: () => ({}),
			withOAuthLifecycle: async () => {
				lifecycleCalls += 1;
			},
		} as unknown as SyncMessagesDeps;
		await syncMessages(
			{
				type: "SYNC_MESSAGES",
				eventId: "evt-messages",
				timestamp: NOW,
				accountId: account.accountId,
				mailboxId,
			},
			silentLogger,
			deps,
		);
		assert.equal(lifecycleCalls, 0);

		assert.deepEqual(
			await mailboxes.listAllByAccount(account.accountId),
			storedMailboxes,
		);
		assert.deepEqual(await messages.get(messageId), storedMessage);
		assert.equal(
			(await accounts.get(account.accountId)).connectionState,
			ConnectionState.Authenticated,
		);
	});

	it("resumes from the stored markers when mail is turned back on", async () => {
		const { account, messageId } = await seedSyncedAccount();
		const storedMailboxes = await mailboxes.listAllByAccount(account.accountId);
		const storedMessage = await messages.get(messageId);

		await setServices(account.accountId, [AccountService.Calendar]);
		await tick();
		await setServices(account.accountId, [
			AccountService.Mail,
			AccountService.Calendar,
		]);

		assert.deepEqual(await tick(), {
			enqueued: 1,
			accountIds: [account.accountId],
		});
		assert.deepEqual(
			await mailboxes.listAllByAccount(account.accountId),
			storedMailboxes,
		);
		assert.deepEqual(await messages.get(messageId), storedMessage);
	});
});
