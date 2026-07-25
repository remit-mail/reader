import {
	mailboxOperationsCreateMailboxMutation,
	mailboxOperationsListMailboxesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { FolderOption } from "@remit/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getMailboxDisplayName } from "@/lib/folder-roles";

/**
 * Creates a mailbox for an account and refreshes the folder list on success.
 * The backend creates the row with a pending sync status and queues the IMAP
 * create, so the folder is usable as a move destination immediately.
 *
 * `createFolder` maps the created mailbox to a `FolderOption` for the kit
 * surfaces that pick it (the filter editor and move picker); `mutation` is
 * exposed for callers that drive their own form state and error surface.
 */
export function useCreateMailbox(accountId: string) {
	const queryClient = useQueryClient();

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
		async (fullPath: string): Promise<FolderOption> => {
			const mailbox = await mutation.mutateAsync({
				path: { accountId },
				body: { fullPath, namespaceType: "personal" },
			});
			return {
				id: mailbox.mailboxId,
				label: getMailboxDisplayName(mailbox.fullPath),
			};
		},
		[mutation, accountId],
	);

	return { createFolder, mutation };
}
