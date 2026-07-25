import {
	mailboxOperationsCreateMailboxMutation,
<<<<<<< HEAD
	mailboxOperationsListMailboxesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { FolderOption } from "@remit/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMailboxDisplayName } from "@/lib/folder-roles";
=======
	mailboxOperationsListMailboxesOptions,
	mailboxOperationsListMailboxesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { FolderOption } from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { composeFolderPath, validateNewFolderName } from "@/lib/new-folder";
>>>>>>> origin/main

/**
 * Creates a mailbox for an account and refreshes the folder list on success.
 * The backend creates the row with a pending sync status and queues the IMAP
 * create, so the folder is usable as a move destination immediately.
 *
<<<<<<< HEAD
 * `createFolder` maps the created mailbox to a `FolderOption` for the kit
 * surfaces that pick it (the filter editor and move picker); `mutation` is
 * exposed for callers that drive their own form state and error surface.
=======
 * `createFolder` takes a leaf name, validates it against the account's current
 * folders with the same IMAP-aware rules the settings form uses (non-empty, no
 * hierarchy delimiter, no collision — INBOX case-insensitive), and rejects with
 * the human-readable reason before any request. The kit surfaces that pick the
 * result render that rejection inline. `mutation` is exposed for callers that
 * drive their own form state and error surface.
>>>>>>> origin/main
 */
export function useCreateMailbox(accountId: string) {
	const queryClient = useQueryClient();

<<<<<<< HEAD
=======
	const { data } = useQuery(
		mailboxOperationsListMailboxesOptions({ path: { accountId } }),
	);

>>>>>>> origin/main
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
<<<<<<< HEAD
		async (fullPath: string): Promise<FolderOption> => {
			const mailbox = await mutation.mutateAsync({
				path: { accountId },
				body: { fullPath, namespaceType: "personal" },
=======
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
>>>>>>> origin/main
			});
			return {
				id: mailbox.mailboxId,
				label: getMailboxDisplayName(mailbox.fullPath),
			};
		},
<<<<<<< HEAD
		[mutation, accountId],
=======
		[mutation, accountId, data],
>>>>>>> origin/main
	);

	return { createFolder, mutation };
}
