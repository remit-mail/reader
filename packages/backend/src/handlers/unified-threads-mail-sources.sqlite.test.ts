import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem } from "@remit/data-ports";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
	MailboxCursorState,
} from "@remit/domain-enums";
import {
	BETTER_SQLITE3_LIMITS,
	createSqliteRepositories,
	type MailboxRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import type { Context } from "openapi-backend";
import { testApiConfig } from "../config/test-config.js";
import type { RemitClient } from "../service/data-client.js";
import { ThreadOperations } from "./thread.js";
import {
	buildInboxMailboxMap,
	executeUnifiedThreadListing,
	type UnifiedThreadClient,
} from "./unified-threads.js";

const SUB = "cognito-sub-1181";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const NOW = 1_700_000_000_000;

let client: UnifiedThreadClient & RemitClient;
let close: () => void;

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	const repos = createSqliteRepositories(
		{
			app: store.db,
			mail: store.db,
			search: store.db,
		},
		BETTER_SQLITE3_LIMITS,
	);
	client = {
		account: repos.account,
		accountSetting: repos.accountSetting,
		mailbox: repos.mailbox,
		address: repos.address,
		message: repos.message,
		threadMessage: repos.threadMessage,
		label: repos.label,
		messageLabel: repos.messageLabel,
	} as unknown as UnifiedThreadClient & RemitClient;
});

afterEach(() => {
	close();
});

const seedAccountWithInboxThread = async (
	syncedServices: AccountItem["syncedServices"],
): Promise<{ accountId: string; mailboxId: string; threadId: string }> => {
	const label = syncedServices.join("-");
	const account = await client.account.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		username: `${label}@example.com`,
		email: `${label}@example.com`,
		authType: AccountAuthType.OauthMicrosoft,
		syncedServices,
		imapHost: "outlook.office365.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
	});
	const created = await client.mailbox.create({
		accountId: account.accountId,
		namespacePrefix: "",
		hierarchyDelimiter: "/",
		fullPath: "INBOX",
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
	if (created.outcome !== "Created") throw new Error("INBOX path taken");
	const mailbox = created.mailbox;
	const messageId = randomUUID();
	await client.message.create({
		messageId,
		mailboxId: mailbox.mailboxId,
		uid: 1,
		sequenceNumber: 1,
		rfc822Size: 10,
		internalDate: NOW,
		envelopeId: randomUUID(),
		rootBodyPartId: randomUUID(),
		status: "active",
		syncStatus: "synced",
	});
	const threadId = randomUUID();
	await client.threadMessage.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		threadId,
		messageId,
		mailboxId: mailbox.mailboxId,
		uid: 1,
		referenceOrder: 0,
		internalDate: NOW,
		sentDate: NOW,
		subject: `hello from ${label}`,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
	});
	return {
		accountId: account.accountId,
		mailboxId: mailbox.mailboxId,
		threadId,
	};
};

const unifiedThreadIds = async (searchText?: string): Promise<string[]> => {
	const response = await executeUnifiedThreadListing(
		client,
		ACCOUNT_CONFIG_ID,
		{
			starredOnly: false,
			searchText,
			count: false,
			results: true,
		},
	);
	return (response.items ?? []).map((item) => item.threadId).sort();
};

describe("a mail-off account in the unified surfaces (#1181)", () => {
	it("leaves the unified list and search, and its mailbox still opens directly", async () => {
		const mailOnly = await seedAccountWithInboxThread([AccountService.Mail]);
		const both = await seedAccountWithInboxThread([
			AccountService.Mail,
			AccountService.Calendar,
		]);
		const calendarOnly = await seedAccountWithInboxThread([
			AccountService.Calendar,
		]);
		const mailSources = [mailOnly.threadId, both.threadId].sort();

		assert.deepEqual(await unifiedThreadIds(), mailSources);
		assert.deepEqual(await unifiedThreadIds("hello"), mailSources);

		const scope = await buildInboxMailboxMap(ACCOUNT_CONFIG_ID, client);
		assert.equal(scope.starredMailboxIds.has(calendarOnly.mailboxId), false);

		const listThreads = ThreadOperations.ThreadOperations_listThreads;
		const opened = (await listThreads(
			{
				request: { params: { mailboxId: calendarOnly.mailboxId }, query: {} },
			} as unknown as Context,
			{
				client,
				config: testApiConfig(),
				identity: {
					kind: "user",
					accountConfigId: ACCOUNT_CONFIG_ID,
					sub: SUB,
					email: "caller@example.com",
				},
			},
		)) as { items: { threadId: string }[] };
		assert.deepEqual(
			opened.items.map((item) => item.threadId),
			[calendarOnly.threadId],
		);
	});
});
