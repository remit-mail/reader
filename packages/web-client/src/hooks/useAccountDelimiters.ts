/**
 * The hierarchy separator each account's own server reports, for surfaces that
 * hold a provider path but not the mailbox row it came from — quarantine, so
 * far. Fans out the same per-account mailbox-list query as
 * `useResultFolderIndex` (cached forever, react-query dedupes the identical key
 * across call sites) and keeps only the delimiter.
 */
import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { folderDelimiter } from "@/lib/move-options";

/**
 * Hoisted so `useQueries` treats this as a memo rather than a per-render
 * reduce — see `useResultFolderIndex`.
 */
const combineDelimiters = (
	results: { data?: { items: RemitImapMailboxResponse[] } }[],
): string[] =>
	results.map((result) => folderDelimiter(result.data?.items ?? []));

export function useAccountDelimiters(
	accountIds: readonly string[],
): ReadonlyMap<string, string> {
	const delimiters = useQueries({
		queries: accountIds.map((accountId) => ({
			...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
			staleTime: Infinity,
		})),
		combine: combineDelimiters,
	});

	return useMemo(
		() =>
			new Map(
				accountIds.map((accountId, i) => [accountId, delimiters[i] ?? "/"]),
			),
		[accountIds, delimiters],
	);
}
