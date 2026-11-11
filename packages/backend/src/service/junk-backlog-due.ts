import {
	isJunkBacklogDue,
	type JunkBacklogAccount,
} from "@remit/mailbox-service/junk-backlog-due";
import type { RemitClient } from "./data-client.js";

export const junkBacklogDue = (
	client: RemitClient<never>,
	account: JunkBacklogAccount,
	now: number,
): Promise<boolean> =>
	isJunkBacklogDue(
		{
			mailboxSpecialUseService: client.mailboxSpecialUse,
			mailboxService: client.mailbox,
			messageService: client.message,
			accountSetting: client.accountSetting,
			accountConfig: client.accountConfig,
			classificationDefault: client.classificationDefault,
		},
		account,
		now,
	);
