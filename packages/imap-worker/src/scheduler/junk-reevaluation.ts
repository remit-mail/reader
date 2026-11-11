import type { RemitClient } from "@remit/backend/client";
import type { AccountItem } from "@remit/data-ports";

const hasJunkBacklog = async (
	client: RemitClient<"accountFanout">,
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
		client: RemitClient<"accountFanout">,
	): ((account: AccountItem) => Promise<boolean>) =>
	async (account) => {
		if (!(await hasJunkBacklog(client, account.accountId))) return false;
		await client.queues.accountFanout.send({
			body: {
				type: "JunkPlacementReevaluation",
				accountConfigId: account.accountConfigId,
				accountId: account.accountId,
			},
		});
		return true;
	};
