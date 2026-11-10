import type { RemitClient } from "@remit/backend/client";
import { junkBacklogDue } from "@remit/backend/junk-backlog";
import type { AccountItem } from "@remit/data-ports";

export const buildJunkReevaluationEnqueue =
	(
		client: RemitClient<"accountFanout">,
	): ((account: AccountItem, now: number) => Promise<boolean>) =>
	async (account, now) => {
		if (!(await junkBacklogDue(client, account, now))) return false;
		await client.queues.accountFanout.send({
			body: {
				type: "JunkPlacementReevaluation",
				accountConfigId: account.accountConfigId,
				accountId: account.accountId,
			},
		});
		return true;
	};
