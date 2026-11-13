import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
	LabelColor,
	MailboxCursorState,
} from "@remit/domain-enums";
import {
	createSqliteRepositories,
	type MailboxRepo,
	messageObjectsInMemory,
	NODE_SQLITE_LIMITS,
} from "@remit/drizzle-service";
import {
	createShippedSqliteDb,
	sharedDatabases,
} from "@remit/drizzle-service/test-sqlite";
import type { RemitClient } from "../service/data-client.js";
import { writeAccountMuted } from "./account-overrides.js";
import {
	executeUnifiedThreadListing,
	type UnifiedThreadClient,
} from "./unified-threads.js";

const ACCOUNT_CONFIG_ID = deriveAccountConfigId("cognito-sub-1639");
const NOW = 1_700_000_000_000;

let client: UnifiedThreadClient & RemitClient;
let close: () => void;

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	const repos = createSqliteRepositories(
		sharedDatabases(store),
		NODE_SQLITE_LIMITS,
		messageObjectsInMemory(),
	);
	client = {
		account: repos.account,
		accountSetting: repos.accountSetting,
		mailbox: repos.mailbox,
		address: repos.address,
		message: repos.message,
		threadMessage: repos.threadMessage,
		label: repos.label,
		labelMailbox: repos.labelMailbox,
		messageLabel: repos.messageLabel,
	} as unknown as UnifiedThreadClient & RemitClient;
});

afterEach(() => {
	close();
});

const seedAccount = async (name: string): Promise<string> => {
	const account = await client.account.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		username: `${name}@example.com`,
		email: `${name}@example.com`,
		authType: AccountAuthType.OauthMicrosoft,
		syncedServices: [AccountService.Mail],
		imapHost: "outlook.office365.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
	});
	return account.accountId;
};

const seedMailbox = async (
	accountId: string,
	fullPath: string,
): Promise<string> => {
	const created = await client.mailbox.create({
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

const seedThread = async (
	mailboxId: string,
	internalDate: number,
): Promise<string> => {
	const messageId = randomUUID();
	await client.message.create({
		messageId,
		mailboxId,
		uid: 1,
		sequenceNumber: 1,
		rfc822Size: 10,
		internalDate,
		status: "active",
		syncStatus: "synced",
	});
	const threadId = randomUUID();
	await client.threadMessage.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		threadId,
		messageId,
		mailboxId,
		uid: 1,
		referenceOrder: 0,
		internalDate,
		sentDate: internalDate,
		subject: "priority mail",
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
	});
	return threadId;
};

const seedLabelledAccount = async (
	name: string,
	labelId: string,
	otherLabelId: string,
	at: number,
): Promise<{ accountId: string; inbox: string; labelled: string }> => {
	const accountId = await seedAccount(name);
	const inboxMailboxId = await seedMailbox(accountId, "INBOX");
	const labelMailboxId = await seedMailbox(
		accountId,
		`INBOX/${name}_remit/Priority`,
	);
	const otherMailboxId = await seedMailbox(
		accountId,
		`INBOX/${name}_remit/Later`,
	);
	await client.labelMailbox.put({
		labelId,
		accountId,
		mailboxId: labelMailboxId,
	});
	await client.labelMailbox.put({
		labelId: otherLabelId,
		accountId,
		mailboxId: otherMailboxId,
	});
	await seedThread(otherMailboxId, at + 2);
	return {
		accountId,
		inbox: await seedThread(inboxMailboxId, at + 1),
		labelled: await seedThread(labelMailboxId, at),
	};
};

describe("listing one label across every account (#1639)", () => {
	it("returns the label's folders in every non-muted account, newest first, and counts them", async () => {
		const priority = await client.label.create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			name: "Priority",
			color: LabelColor.Default,
		});
		const later = await client.label.create({
			accountConfigId: ACCOUNT_CONFIG_ID,
			name: "Later",
			color: LabelColor.Default,
		});
		const a = await seedLabelledAccount(
			"a",
			priority.labelId,
			later.labelId,
			NOW,
		);
		const b = await seedLabelledAccount(
			"b",
			priority.labelId,
			later.labelId,
			NOW + 10,
		);
		const muted = await seedLabelledAccount(
			"c",
			priority.labelId,
			later.labelId,
			NOW + 20,
		);
		await writeAccountMuted(
			client.accountSetting,
			ACCOUNT_CONFIG_ID,
			muted.accountId,
			{ value: true, setAt: NOW },
		);

		const response = await executeUnifiedThreadListing(
			client,
			ACCOUNT_CONFIG_ID,
			{
				starredOnly: false,
				labelId: priority.labelId,
				count: true,
				results: true,
			},
		);

		assert.deepEqual(
			(response.items ?? []).map((item) => [item.threadId, item.accountId]),
			[
				[b.labelled, b.accountId],
				[a.labelled, a.accountId],
			],
		);
		assert.equal(response.count, 2);

		const foreign = await executeUnifiedThreadListing(
			client,
			ACCOUNT_CONFIG_ID,
			{
				starredOnly: false,
				labelId: randomUUID(),
				count: true,
				results: true,
			},
		);
		assert.deepEqual(foreign, { items: [], count: 0 });
	});
});
