import type { AccountItem } from "@remit/data-ports";
import { accountOwnershipRefusal } from "../service/guards.js";
import { refusalError } from "../service/outcome.js";

export const assertAccountOwnership = (
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	callerAccountConfigId: string,
	mode: "read" | "act",
): void => {
	const refusal = accountOwnershipRefusal(account, callerAccountConfigId, mode);
	if (refusal) throw refusalError(refusal);
};
