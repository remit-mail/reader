import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";

export const compareAccounts = (
	a: RemitImapAccountResponse,
	b: RemitImapAccountResponse,
): number => {
	if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
	return a.accountId.localeCompare(b.accountId);
};

export const sortAccountsByCreatedAt = <T extends RemitImapAccountResponse>(
	accounts: readonly T[],
): T[] => [...accounts].sort(compareAccounts);
