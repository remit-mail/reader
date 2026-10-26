import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { RemitClient } from "@remit/backend/client";
import type { AccountItem } from "@remit/data-ports";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
	MailboxCursorState,
} from "@remit/domain-enums";
import {
	type AccountRepo,
	createSqliteRepositories,
	type DrizzleMessageRepository,
	MailboxLockRepo,
	type MailboxRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import type { Logger } from "@remit/logger";
import { createConnectionPool } from "./connection-pool.js";
import type { ProcessContext } from "./context.js";
import { syncMailboxes } from "./handlers/sync-mailboxes.js";
import { syncMessages } from "./handlers/sync-messages.js";
import { runSchedulerTick } from "./scheduler/run-tick.js";
import { processContext } from "./test-helpers/process-context.js";
import { workerQueuesOn } from "./test-helpers/worker-queues.js";

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
let locks: MailboxLockRepo;
let client: RemitClient;
let close: () => void;

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	const repos = createSqliteRepositories({
		app: store.db,
		mail: store.db,
		search: store.db,
	});
	accounts = repos.account;
	mailboxes = repos.mailbox;
	messages = repos.message;
	locks = new MailboxLockRepo(store.db);
	client = {
		account: accounts,
		mailbox: mailboxes,
		message: messages,
		mailboxLock: locks,
	} as unknown as RemitClient;
});

afterEach(() => {
	close();
});

const ctxWith = (pool: ProcessContext["pool"]): ProcessContext =>
	processContext({
		client,
		queues: workerQueuesOn(recordingQueue()),
		log: silentLogger,
		pool,
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
	const created = await mailboxes.create({
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
	if (created.outcome !== "Created") throw new Error("INBOX path taken");
	const mailbox = created.mailbox;
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
	const queue = recordingQueue();
	const result = await runSchedulerTick({
		redriveStrandedPlacements: async () => 0,
		accountService: accounts,
		queue: queue.fifo,
		log: silentLogger,
		tickIntervalMs: 60_000,
		offlineIntervalMs: 0,
		now: NOW,
	});
	return {
		enqueued: result.enqueued,
		accountIds: queue.sent.map((message) => String(message.body.accountId)),
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
			ctxWith(
				createConnectionPool({ size: 1, overflow: "Open" }, () => {
					throw new Error("a sync that is off must not connect");
				}),
			),
		);

		let connections = 0;
		await syncMessages(
			{
				type: "SYNC_MESSAGES",
				eventId: "evt-messages",
				timestamp: NOW,
				accountId: account.accountId,
				mailboxId,
			},
			ctxWith(
				createConnectionPool({ size: 1, overflow: "Open" }, () => {
					connections += 1;
					throw new Error("a sync that is off must not connect");
				}),
			),
		);
		assert.equal(connections, 0);

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
