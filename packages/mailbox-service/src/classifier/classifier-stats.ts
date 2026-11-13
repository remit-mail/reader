import { OFFSET_BEARING } from "@remit/calendar-service";
import type {
	ClassifierStatsItem,
	IAccountRepository,
	IAddressRepository,
	IMailboxRepository,
	IMessageRepository,
} from "@remit/data-ports";

export interface ClassifierStatsDeps {
	account: Pick<IAccountRepository, "listAllByAccountConfig">;
	mailbox: Pick<IMailboxRepository, "listAllByAccount">;
	message: Pick<IMessageRepository, "countClassifiedSince">;
	address: Pick<IAddressRepository, "countCategoryOverridesSince">;
}

export type ClassifierStatsOutcome =
	| { ok: true; value: ClassifierStatsItem }
	| { ok: false; message: string };

export const readClassifierStats = async (
	deps: ClassifierStatsDeps,
	accountConfigId: string,
	since: string,
): Promise<ClassifierStatsOutcome> => {
	const sinceMs = Date.parse(since);
	if (Number.isNaN(sinceMs) || !OFFSET_BEARING.test(since)) {
		return {
			ok: false,
			message: "`since` must be an ISO 8601 date-time with a zone offset",
		};
	}
	const accounts = await deps.account.listAllByAccountConfig(accountConfigId);
	const mailboxIds = (
		await Promise.all(
			accounts.map((account) =>
				deps.mailbox.listAllByAccount(account.accountId),
			),
		)
	).flatMap((mailboxes) => mailboxes.map((mailbox) => mailbox.mailboxId));
	const counts = await deps.message.countClassifiedSince(mailboxIds, sinceMs);
	return {
		ok: true,
		value: {
			since,
			examined: counts.byCategory.reduce((sum, row) => sum + row.count, 0),
			byCategory: counts.byCategory,
			byLabel: counts.byLabel,
			corrections: {
				spamReportedNotJunk: counts.spamReportedNotJunk,
				categoryOverridden: await deps.address.countCategoryOverridesSince(
					accountConfigId,
					sinceMs,
				),
			},
		},
	};
};
