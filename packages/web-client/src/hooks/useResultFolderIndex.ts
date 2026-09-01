/**
 * Fans out the per-account mailbox-list query (the same one `MailSidebarAdapter`
 * and `useMailboxNameIndex` run — cached forever, react-query dedupes the
 * identical key across call sites) and reduces it to the mailboxId → folder map
 * search results resolve their provenance against. See `lib/result-folder.ts`.
 *
 * The read state travels with the index: a folder label cut on a delimiter that
 * has not arrived is wrong rather than late, so a surface that names folders can
 * wait for this, and say so when it fails.
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

interface MailboxListsState {
	items: MailboxItems[];
	isPending: boolean;
	error: Error | null;
}

export interface ResultFolderIndexState {
	index: ResultFolderIndex;
	isPending: boolean;
	error: Error | null;
}

/**
 * Hoisted, not inline: `useQueries` skips re-running `combine` when it is given
 * the same function, so a stable reference is what makes this a memo rather than
 * a per-render reduce. Without it the index — and every search-result memo keyed
 * on it — rebuilds on every render.
 */
const combineMailboxLists = (
	results: {
		data?: { items: MailboxItems };
		isPending: boolean;
		error: Error | null;
	}[],
): MailboxListsState => ({
	items: results.map((result) => result.data?.items ?? []),
	isPending: results.some((result) => result.isPending),
	error: results.find((result) => result.error)?.error ?? null,
});

export function useResultFolderIndex(
	accounts: RemitImapAccountResponse[],
): ResultFolderIndexState {
	const mailboxLists = useQueries({
		queries: accounts.map((account) => ({
			...mailboxOperationsListMailboxesOptions({
				path: { accountId: account.accountId },
			}),
			staleTime: Infinity,
		})),
		combine: combineMailboxLists,
	});

	const index = useMemo(
		() =>
			buildResultFolderIndex(
				accounts.map((account, i) => ({
					folderAppointments: account.folderAppointments,
					mailboxes: mailboxLists.items[i] ?? [],
				})),
			),
		[accounts, mailboxLists],
	);

	return {
		index,
		isPending: mailboxLists.isPending,
		error: mailboxLists.error,
	};
}
