import {
	mailboxOperationsCreateMailboxMutation,
	mailboxOperationsListMailboxesOptions,
	mailboxOperationsListMailboxesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { FolderOption } from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { waitForMailboxSynced } from "@/lib/mailbox-sync-wait";
import { composeFolderPath, validateNewFolderName } from "@/lib/new-folder";

/**
 * Creates a mailbox for an account and refreshes the folder list on success.
 * The backend creates the row with a pending sync status and queues the IMAP
 * create.
 *
 * `createFolder` is the seam for dependent writes: a folder created so a filter
 * can move mail into it, or so a move can land mail there. It takes a leaf name,
 * validates it against the account's current folders with the same IMAP-aware
 * rules the settings form uses (non-empty, no hierarchy delimiter, no collision —
 * INBOX case-insensitive), and rejects with the human-readable reason before any
 * request. It then WAITS for the mail server to confirm the folder before
 * resolving — a folder is not a valid target until it exists on the server, and
 * binding a filter or a move to a still-pending row races the folder into
 * existence and cannot report a create that fails. It resolves with the confirmed
 * folder (carrying the path the server normalized to), rejects with a distinct
 * message when the create fails or never confirms, and the kit surfaces that
 * render either the "Creating folder…" wait or the failure inline. `mutation` is
 * exposed for callers that drive their own form state and want the optimistic,
 * non-waiting create (the standalone settings create).
 */
export function useCreateMailbox(accountId: string) {
	const queryClient = useQueryClient();

	const { data } = useQuery(
		mailboxOperationsListMailboxesOptions({ path: { accountId } }),
	);

	const mutation = useMutation({
		...mailboxOperationsCreateMailboxMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: mailboxOperationsListMailboxesQueryKey({
					path: { accountId },
				}),
			});
		},
	});

	const createFolder = useCallback(
		async (name: string): Promise<FolderOption> => {
			const items = data?.items ?? [];
			const delimiter = items[0]?.hierarchyDelimiter ?? "/";
			const problem = validateNewFolderName({
				name,
				delimiter,
				existingPaths: items.map((item) => item.fullPath),
			});
			if (problem) throw new Error(problem);
			const mailbox = await mutation.mutateAsync({
				path: { accountId },
				body: { fullPath: composeFolderPath(name), namespaceType: "personal" },
			});
			const confirmed = await waitForMailboxSynced({
				mailboxId: mailbox.mailboxId,
				fetchMailboxes: async () => {
					const response = await queryClient.fetchQuery({
						...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
						staleTime: 0,
					});
					return response.items ?? [];
				},
			});
			return {
				id: confirmed.mailboxId,
				label: getMailboxDisplayName(confirmed.fullPath),
			};
		},
		[mutation, accountId, data, queryClient],
	);

	return { createFolder, mutation };
}
