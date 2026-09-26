import assert from "node:assert/strict";
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
	MailboxRepo,
} from "@remit/drizzle-service";
import { createShippedSqliteDb } from "@remit/drizzle-service/test-sqlite";
import { buildInboxMailboxMap } from "./unified-threads.js";

const ACCOUNT_CONFIG_ID = "cfg-1181";

let accounts: AccountRepo;
let mailboxes: MailboxRepo;
let accountSettings: AccountSettingRepo;
let close: () => void;

beforeEach(() => {
	const store = createShippedSqliteDb();
	close = store.close;
	accounts = new AccountRepo(store.db);
	mailboxes = new MailboxRepo(store.db);
	accountSettings = new AccountSettingRepo(store.db);
});

afterEach(() => {
	close();
});

const seedAccountWithInbox = async (
	syncedServices: AccountItem["syncedServices"],
): Promise<{ accountId: string; mailboxId: string }> => {
	const account = await accounts.create({
		accountConfigId: ACCOUNT_CONFIG_ID,
		username: `${syncedServices.join("-")}@example.com`,
		email: `${syncedServices.join("-")}@example.com`,
		authType: AccountAuthType.OauthMicrosoft,
		syncedServices,
		imapHost: "outlook.office365.com",
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
		cursorState: MailboxCursorState.normal,
	} as Parameters<MailboxRepo["create"]>[0]);
	return { accountId: account.accountId, mailboxId: mailbox.mailboxId };
};

describe("the unified scope and the account's synced services", () => {
	it("reads the unified list, the brief and search only from accounts that sync mail", async () => {
		const mailOnly = await seedAccountWithInbox([AccountService.Mail]);
		const both = await seedAccountWithInbox([
			AccountService.Mail,
			AccountService.Calendar,
		]);
		const calendarOnly = await seedAccountWithInbox([AccountService.Calendar]);

		const scope = await buildInboxMailboxMap(ACCOUNT_CONFIG_ID, {
			account: accounts,
			mailbox: mailboxes,
			accountSetting: accountSettings,
		});

		const expected = [mailOnly.mailboxId, both.mailboxId].sort();
		assert.deepEqual([...scope.inboxMailboxIds].sort(), expected);
		assert.deepEqual([...scope.starredMailboxIds].sort(), expected);
		assert.deepEqual([...scope.searchMailboxIds].sort(), expected);
		assert.equal(scope.mailboxIdToAccountId.has(calendarOnly.mailboxId), false);
	});

	it("keeps the stored mailboxes of a mail-off account addressable", async () => {
		const calendarOnly = await seedAccountWithInbox([AccountService.Calendar]);

		const stored = await mailboxes.listAllByAccount(calendarOnly.accountId);

		assert.deepEqual(
			stored.map((mailbox) => mailbox.mailboxId),
			[calendarOnly.mailboxId],
		);
	});
});
