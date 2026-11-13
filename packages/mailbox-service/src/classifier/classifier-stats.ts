import {
	type ClassifierFolderCounts,
	type ClassifierStatsItem,
	emptyFolderCounts,
	type IAccountRepository,
	type IAddressRepository,
	type IMailboxRepository,
	type IMessageRepository,
} from "@remit/data-ports";
import { ClassificationLabel, MessageCategory } from "@remit/domain-enums";

export interface ClassifierStatsDeps {
	account: Pick<IAccountRepository, "listAllByAccountConfig">;
	mailbox: Pick<IMailboxRepository, "listAllByAccount">;
	message: Pick<IMessageRepository, "countClassifiedSince">;
	address: Pick<IAddressRepository, "countCategoryOverridesSince">;
}

export type ClassifierStatsOutcome =
	| { ok: true; value: ClassifierStatsItem }
	| { ok: false; message: string };

const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})$/;

const addCounts = (
	total: ClassifierFolderCounts,
	folder: ClassifierFolderCounts,
): ClassifierFolderCounts => {
	const sum = emptyFolderCounts();
	sum.examined = total.examined + folder.examined;
	sum.spamReportedNotJunk =
		total.spamReportedNotJunk + folder.spamReportedNotJunk;
	for (const category of Object.values(MessageCategory)) {
		sum.byCategory[category] =
			total.byCategory[category] + folder.byCategory[category];
	}
	for (const label of Object.values(ClassificationLabel)) {
		sum.byLabel[label] = total.byLabel[label] + folder.byLabel[label];
	}
	return sum;
};

export const readClassifierStats = async (
	deps: ClassifierStatsDeps,
	accountConfigId: string,
	since: string,
): Promise<ClassifierStatsOutcome> => {
	const sinceMs = Date.parse(since);
	if (Number.isNaN(sinceMs) || !OFFSET_DATE_TIME.test(since)) {
		return {
			ok: false,
			message: "`since` must be an ISO 8601 date-time with a zone offset",
		};
	}
	let total = emptyFolderCounts();
	for (const account of await deps.account.listAllByAccountConfig(
		accountConfigId,
	)) {
		for (const mailbox of await deps.mailbox.listAllByAccount(
			account.accountId,
		)) {
			total = addCounts(
				total,
				await deps.message.countClassifiedSince(mailbox.mailboxId, sinceMs),
			);
		}
	}
	return {
		ok: true,
		value: {
			since,
			examined: total.examined,
			byCategory: total.byCategory,
			byLabel: total.byLabel,
			corrections: {
				spamReportedNotJunk: total.spamReportedNotJunk,
				categoryOverridden: await deps.address.countCategoryOverridesSince(
					accountConfigId,
					sinceMs,
				),
			},
		},
	};
};
