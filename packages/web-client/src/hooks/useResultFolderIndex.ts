/**
 * Fans out the per-account mailbox-list query (the same one `MailSidebarAdapter`
 * and `useMailboxNameIndex` run — cached forever, react-query dedupes the
 * identical key across call sites) and reduces it to the mailboxId → folder map
 * search results resolve their provenance against. See `lib/result-folder.ts`.
 */
import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	buildResultFolderIndex,
	type ResultFolderIndex,
} from "@/lib/result-folder";

export function useResultFolderIndex(
	accounts: RemitImapAccountResponse[],
): ResultFolderIndex {
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
			buildResultFolderIndex(
				accounts.map((account, i) => ({
					folderAppointments: account.folderAppointments,
					mailboxes: mailboxQueries[i]?.data?.items ?? [],
				})),
			),
		[accounts, mailboxQueries],
	);
}
