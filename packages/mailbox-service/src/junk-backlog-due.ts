import type {
	IAccountConfigRepository,
	IAccountSettingRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageRepository,
	MessageItem,
} from "@remit/data-ports";
import { parseAccountSettingValue } from "@remit/data-ports/account-settings";
import {
	type ClassificationDeploymentDefault,
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import { readResolvedClassification } from "@remit/data-ports/classification-resolver";
import { AccountSettingName } from "@remit/domain-enums";

export interface JunkBacklogAccount {
	accountId: string;
	accountConfigId: string;
}

export interface JunkBacklogLookup {
	mailboxSpecialUseService: Pick<
		IMailboxSpecialUseRepository,
		"findJunkMailbox"
	>;
	mailboxService: Pick<IMailboxRepository, "get">;
	messageService: Pick<IMessageRepository, "listUndecidedJunkBacklog">;
}

export interface JunkBacklogProbeDeps extends JunkBacklogLookup {
	accountSetting: Pick<IAccountSettingRepository, "get" | "getMany">;
	accountConfig: Pick<IAccountConfigRepository, "get">;
	classificationDefault: ClassificationDeploymentDefault;
}

type RoleMailbox = { mailboxId: string; fullPath: string };

export const junkBacklogOf = async (
	deps: JunkBacklogLookup,
	accountId: string,
	limit: number,
): Promise<{ junk: RoleMailbox; messages: MessageItem[] } | null> => {
	const junk = await deps.mailboxSpecialUseService.findJunkMailbox(accountId);
	if (!junk) return null;
	const mailbox = await deps.mailboxService.get(accountId, junk.mailboxId);
	return {
		junk,
		messages: await deps.messageService.listUndecidedJunkBacklog(
			junk.mailboxId,
			mailbox.createdAt,
			limit,
		),
	};
};

const classifierBudgetLeft = async (
	deps: JunkBacklogProbeDeps,
	{ accountId, accountConfigId }: JunkBacklogAccount,
	now: number,
): Promise<boolean> => {
	const resolved = await readResolvedClassification(deps, accountConfigId);
	if (resolved.state !== "Configured" || !resolved.enabled.value) return true;
	const row = await deps.accountSetting.get(
		accountConfigId,
		classificationUsageName(accountId),
	);
	if (!row) return true;
	const usage = parseAccountSettingValue(
		AccountSettingName.ClassificationUsage,
		row.value,
	).value;
	return (
		usage.date !== utcDateOf(now) || usage.calls < resolved.dailyLimit.value
	);
};

export const isJunkBacklogDue = async (
	deps: JunkBacklogProbeDeps,
	account: JunkBacklogAccount,
	now: number,
): Promise<boolean> => {
	if (!(await classifierBudgetLeft(deps, account, now))) return false;
	const backlog = await junkBacklogOf(deps, account.accountId, 1);
	return (backlog?.messages.length ?? 0) > 0;
};
