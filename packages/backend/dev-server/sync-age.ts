import type { IAccountRepository, IMailboxRepository } from "@remit/data-ports";

export interface SyncAgeSource {
	readonly account: Pick<IAccountRepository, "listAll">;
	readonly mailbox: Pick<IMailboxRepository, "listAllByAccount">;
}

export interface AccountSyncAge {
	readonly accountId: string;
	readonly ageSeconds: number;
}

/**
 * Seconds since each account last completed a message-sync round
 * (standalone-observability D3).
 *
 * Measured from `mailbox.lastMessageSyncAt`, not `account.lastSyncAt`.
 * `account.lastSyncAt` is stamped after the mailbox *list* sync and before the
 * per-mailbox fan-out that fetches messages, so a deployment whose message
 * handlers all throw keeps it fresh forever while no mail arrives.
 * `lastMessageSyncAt` is stamped at the end of a message-sync round, after the
 * fetch and the writes.
 *
 * The value is the age of the newest such stamp across the account's mailboxes:
 * seconds since this account last completed a round trip that would have found
 * new mail if there were any. An account with no stamped mailbox has never
 * completed one, and reports the age of the account row instead of being
 * omitted — "never synced" is the condition most worth seeing, not a gap in the
 * series.
 *
 * Labelled by account id, never by address: a scraped label travels wherever
 * the scrape goes.
 */
export const collectAccountSyncAges = async (
	source: SyncAgeSource,
	now: number,
): Promise<AccountSyncAge[]> => {
	const accounts = await source.account.listAll();
	const ages: AccountSyncAge[] = [];
	for (const account of accounts) {
		if (account.deletedAt) continue;
		const mailboxes = await source.mailbox.listAllByAccount(account.accountId);
		const stamps = mailboxes
			.map((mailbox) => mailbox.lastMessageSyncAt)
			.filter(
				(stamp): stamp is number => typeof stamp === "number" && stamp > 0,
			);
		const newest = stamps.length > 0 ? Math.max(...stamps) : account.createdAt;
		ages.push({
			accountId: account.accountId,
			ageSeconds: Math.max(0, Math.round((now - newest) / 1000)),
		});
	}
	return ages;
};
