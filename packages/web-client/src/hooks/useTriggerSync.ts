import {
	mailboxOperationsListMailboxesQueryKey,
	syncOperationsTriggerSyncMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTelemetry } from "@/lib/telemetry-context";

interface UseTriggerSyncResult {
	trigger: () => void;
	triggerAsync: () => Promise<unknown>;
	isPending: boolean;
	// TanStack types this as the generated wire body now that the operation
	// declares its failures; by the time it arrives, `client.ts`'s error
	// interceptor has re-wrapped it as an `ApiError` and `taggedFetch` a
	// transport failure as a `NetworkError`. `unknown` is what the declared type
	// and the real one agree on, and every reader goes through
	// `formatErrorMessage`.
	error: unknown;
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
	const telemetry = useTelemetry();

	const mutation = useMutation({
		...syncOperationsTriggerSyncMutation(),
		onSuccess: () => {
			telemetry.recordEvent("sync.triggered");
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
