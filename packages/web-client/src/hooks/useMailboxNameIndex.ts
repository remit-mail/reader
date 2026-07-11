/**
 * Fans out the per-account mailbox-list query (mirrors `MailSidebarAdapter` /
 * `useMailboxAccount` — cached forever, react-query dedupes the identical
 * query key across call sites) and reduces it to the name index `in:` tokens
 * resolve against (#428 follow-up, see doc/design/flows/06-search.md).
 */
import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { buildMailboxNameIndex } from "@/lib/search-token-index";

export function useMailboxNameIndex(
	accounts: RemitImapAccountResponse[],
): ReadonlyMap<string, string> {
	const mailboxQueries = useQueries({
		queries: accounts.map((account) => ({
			...mailboxOperationsListMailboxesOptions({
				path: { accountId: account.accountId },
			}),
			staleTime: Infinity,
		})),
	});

	return useMemo(
		() =>
			buildMailboxNameIndex(
				mailboxQueries.map((query) => query.data?.items ?? []),
			),
		[mailboxQueries],
	);
}
