import type { RemitClient } from "@remit/backend/client";
import type { AccountItem } from "@remit/data-ports";
import { isClassificationBudgetSpent } from "@remit/data-ports/classification-resolver";

export type JunkReevaluationClient = Pick<
	RemitClient<"accountFanout">,
	| "mailboxSpecialUse"
	| "mailbox"
	| "message"
	| "accountSetting"
	| "accountConfig"
	| "classificationDefault"
	| "queues"
>;

const hasJunkBacklog = async (
	client: JunkReevaluationClient,
	accountId: string,
): Promise<boolean> => {
	const junk = await client.mailboxSpecialUse.findJunkMailbox(accountId);
	if (!junk) return false;
	const folder = await client.mailbox.get(accountId, junk.mailboxId);
	const backlog = await client.message.listJunkBacklog(
		junk.mailboxId,
		folder.createdAt,
		1,
	);
	return backlog.length > 0;
};

export const buildJunkReevaluationEnqueue =
	(
		client: JunkReevaluationClient,
	): ((account: AccountItem, now: number) => Promise<boolean>) =>
	async (account, now) => {
		if (!(await hasJunkBacklog(client, account.accountId))) return false;
		if (await isClassificationBudgetSpent(client, account, now)) return false;
		await client.queues.accountFanout.send({
			body: {
				type: "JunkPlacementReevaluation",
				accountConfigId: account.accountConfigId,
				accountId: account.accountId,
			},
		});
		return true;
	};
