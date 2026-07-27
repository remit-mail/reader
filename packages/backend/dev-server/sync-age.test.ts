import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import { collectAccountSyncAges, type SyncAgeSource } from "./sync-age.js";

const NOW = 1_700_000_000_000;

const account = (overrides: Partial<AccountItem>): AccountItem =>
	({
		accountId: "acct-1",
		createdAt: NOW - 600_000,
		lastSyncAt: NOW,
		...overrides,
	}) as AccountItem;

const mailbox = (lastMessageSyncAt: number): MailboxItem =>
	({ mailboxId: `mbx-${lastMessageSyncAt}`, lastMessageSyncAt }) as MailboxItem;

const source = (
	accounts: AccountItem[],
	mailboxes: Record<string, MailboxItem[]>,
): SyncAgeSource => ({
	account: { listAll: async () => accounts },
	mailbox: {
		listAllByAccount: async (accountId: string) => mailboxes[accountId] ?? [],
	},
});

describe("collectAccountSyncAges", () => {
	it("measures from the newest mailbox message-sync stamp", async () => {
		const ages = await collectAccountSyncAges(
			source([account({})], {
				"acct-1": [mailbox(NOW - 300_000), mailbox(NOW - 60_000)],
			}),
			NOW,
		);
		assert.deepEqual(ages, [{ accountId: "acct-1", ageSeconds: 60 }]);
	});

	it("ignores account.lastSyncAt, which is stamped before the message fan-out", async () => {
		// lastSyncAt is fresh and every message handler has been failing for an
		// hour. The exported age must report the hour.
		const ages = await collectAccountSyncAges(
			source([account({ lastSyncAt: NOW })], {
				"acct-1": [mailbox(NOW - 3_600_000)],
			}),
			NOW,
		);
		assert.deepEqual(ages, [{ accountId: "acct-1", ageSeconds: 3600 }]);
	});

	it("treats an unstamped mailbox as never synced", async () => {
		const ages = await collectAccountSyncAges(
			source([account({ createdAt: NOW - 900_000 })], {
				"acct-1": [mailbox(0)],
			}),
			NOW,
		);
		assert.deepEqual(ages, [{ accountId: "acct-1", ageSeconds: 900 }]);
	});

	it("reports an account with no mailboxes at all rather than omitting it", async () => {
		const ages = await collectAccountSyncAges(
			source([account({ createdAt: NOW - 120_000 })], {}),
			NOW,
		);
		assert.deepEqual(ages, [{ accountId: "acct-1", ageSeconds: 120 }]);
	});

	it("skips a deleted account", async () => {
		const ages = await collectAccountSyncAges(
			source(
				[
					account({ accountId: "gone", deletedAt: NOW - 1000 }),
					account({ accountId: "live" }),
				],
				{ live: [mailbox(NOW - 30_000)] },
			),
			NOW,
		);
		assert.deepEqual(ages, [{ accountId: "live", ageSeconds: 30 }]);
	});

	it("never reports a negative age when a stamp is ahead of the clock", async () => {
		const ages = await collectAccountSyncAges(
			source([account({})], { "acct-1": [mailbox(NOW + 5_000)] }),
			NOW,
		);
		assert.deepEqual(ages, [{ accountId: "acct-1", ageSeconds: 0 }]);
	});
});
