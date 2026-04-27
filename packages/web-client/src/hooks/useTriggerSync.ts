import {
	mailboxOperationsListMailboxesQueryKey,
	syncOperationsTriggerSyncMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface UseTriggerSyncResult {
	trigger: () => void;
	triggerAsync: () => Promise<unknown>;
	isPending: boolean;
	error: Error | null;
	reset: () => void;
}

/**
 * Build the TanStack query key for the mailbox-list query owned by the
 * given account. Extracted from the hook so the staleness/invalidation
 * contract can be unit-tested without rendering React.
 */
export const buildMailboxListKey = (accountId: string) =>
	mailboxOperationsListMailboxesQueryKey({ path: { accountId } });

/**
 * Trigger a server-side mailbox-list sync for an account.
 *
 * Wraps the generated `syncOperationsTriggerSync` mutation. The backend
 * enqueues a SYNC_MAILBOXES SQS event and the worker picks it up; the
 * mutation resolves as soon as the enqueue ack returns, not when the
 * sync itself finishes. We invalidate the account's mailboxes query on
 * success so the freshly-synced rows are re-fetched once the worker
 * writes them — TanStack will pick the new data up via its background
 * refetch on the next render.
 */
export const useTriggerSync = (accountId: string): UseTriggerSyncResult => {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...syncOperationsTriggerSyncMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: buildMailboxListKey(accountId),
			});
		},
	});

	return {
		trigger: () => {
			mutation.mutate({ path: { accountId } });
		},
		triggerAsync: () => mutation.mutateAsync({ path: { accountId } }),
		isPending: mutation.isPending,
		error: mutation.error,
		reset: mutation.reset,
	};
};
