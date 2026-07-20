/**
 * Fans out the per-account mailbox-list query (the same one `MailSidebarAdapter`
 * and `useMailboxNameIndex` run — cached forever, react-query dedupes the
 * identical key across call sites) and reduces it to the mailboxId → folder map
 * search results resolve their provenance against. See `lib/result-folder.ts`.
 */
import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	buildResultFolderIndex,
	type ResultFolderIndex,
} from "@/lib/result-folder";

type MailboxItems = RemitImapMailboxResponse[];

/**
 * Hoisted, not inline: `useQueries` skips re-running `combine` when it is given
 * the same function, so a stable reference is what makes this a memo rather than
 * a per-render reduce. Without it the index — and every search-result memo keyed
 * on it — rebuilds on every render.
 */
const combineMailboxItems = (
	results: { data?: { items: MailboxItems } }[],
): MailboxItems[] => results.map((result) => result.data?.items ?? []);

export function useResultFolderIndex(
	accounts: RemitImapAccountResponse[],
): ResultFolderIndex {
	const mailboxItems = useQueries({
		queries: accounts.map((account) => ({
			...mailboxOperationsListMailboxesOptions({
				path: { accountId: account.accountId },
			}),
			staleTime: Infinity,
		})),
		combine: combineMailboxItems,
	});

	return useMemo(
		() =>
			buildResultFolderIndex(
				accounts.map((account, i) => ({
					folderAppointments: account.folderAppointments,
					mailboxes: mailboxItems[i] ?? [],
				})),
			),
		[accounts, mailboxItems],
	);
}
