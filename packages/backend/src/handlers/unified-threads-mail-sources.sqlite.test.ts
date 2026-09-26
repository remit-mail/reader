import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem } from "@remit/data-ports";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
	MailboxCursorState,
} from "@remit/domain-enums";
import {
	AccountRepo,
	AccountSettingRepo,
	AddressRepo,
	DrizzleMessageRepository,
	DrizzleThreadMessageRepository,
	LabelRepo,
	MailboxRepo,
	MessageLabelRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
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
	store.sqlite.exec(
		readFileSync(
			new URL(
				"../../../../npm-scripts/sqlite-search-index.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	close = store.close;
	const db = store.db as never;
	client = {
		account: new AccountRepo(store.db),
		accountSetting: new AccountSettingRepo(store.db),
		mailbox: new MailboxRepo(store.db),
		address: new AddressRepo(store.db),
		message: new DrizzleMessageRepository(db),
		threadMessage: new DrizzleThreadMessageRepository(db),
		label: new LabelRepo(store.db),
		messageLabel: new MessageLabelRepo(store.db),
	} as unknown as UnifiedThreadClient & RemitClient;
	setClient(client);
});

afterEach(() => {
	_resetForTest();
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

		const listThreads = ThreadOperations.ThreadOperations_listThreads as (
			context: Context,
			event: APIGatewayProxyEvent,
		) => Promise<unknown>;
		const opened = (await listThreads(
			{
				request: { params: { mailboxId: calendarOnly.mailboxId }, query: {} },
			} as unknown as Context,
			{
				requestContext: { authorizer: { claims: { sub: SUB } } },
			} as unknown as APIGatewayProxyEvent,
		)) as { items: { threadId: string }[] };
		assert.deepEqual(
			opened.items.map((item) => item.threadId),
			[calendarOnly.threadId],
		);
	});
});
