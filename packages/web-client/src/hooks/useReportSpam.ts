import {
	mailboxOperationsListMailboxesQueryKey,
	threadDetailOperationsListThreadMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	messageBulkOperationsNotSpam,
	messageBulkOperationsReportSpam,
} from "@remit/api-http-client/sdk.gen.ts";
import type { RemitImapSpamReportBulkResult } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { ApiError } from "@/lib/api";
import { runChunkedMutation } from "@/lib/bulk-actions";
import {
	invalidateThreadListQueries,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";

interface UseReportSpamOptions {
	/** The mailbox the message currently sits in — scopes which list caches settle-time invalidation reaches. */
	mailboxId: string;
	threadId?: string;
	accountId?: string;
	/**
	 * Called once a report or undo succeeds, with the message ids it acted on
	 * — the same shape as `useMoveMessages`/`useDeleteMessages`'s option of the
	 * same name, so a host wires the identical `handleDeselectIfRemoved` it
	 * already has. Fires on SUCCESS here, not optimistically like those two:
	 * neither endpoint tells the client whether the message actually left
	 * `mailboxId` (reporting or undoing a message already in Junk is a real
	 * no-op-move, and the client has no way to predict it for `notSpam` — see
	 * `throwOnBulkFailure`'s neighbour below), so firing early would deselect a
	 * message that never moved. Firing late means a message that DID move
	 * still needs deselecting once the change is real, so this still exists —
	 * a host that reports the open message and never hears about it keeps
	 * rendering it from a pre-report snapshot forever (issue #648 review).
	 */
	onAfterOptimisticRemove?: (messageIds: string[]) => void;
}

/**
 * The one designed, allowlisted reason returned by the server as-is (e.g.
 * `notSpam`'s move-not-settled-yet message) is safe to show verbatim; an
 * unexpected failure is already flattened server-side to this same generic
 * text (`GENERIC_FAILURE_REASON` in `packages/backend/src/handlers/message.ts`)
 * before it reaches the client. Used only as a fallback for the case neither
 * hits: a `failures` entry missing its `reason`, or no `failures` array at all
 * despite a non-zero `failureCount`.
 */
export const GENERIC_SPAM_ACTION_FAILURE =
	"This message could not be processed. Please try again.";

/**
 * The server's designed failure text names the message by embedding its raw
 * UUID as a possessive subject — e.g. "Message 7f3a2c19-...'s move to Junk
 * has not settled yet; try again in a moment." Accurate, but not something to
 * put in front of a person. This targets that one known shape (`Message
 * <uuid>'s`) and swaps it for plain language, leaving the rest of the
 * sentence — and any reason that doesn't match, including the generic
 * fallback — untouched. Not a parse of the reason's meaning (the field is
 * documented "not intended to be parsed programmatically"): a UUID is an
 * opaque identifier either way, so replacing its rendering is not reading
 * anything into what the sentence says.
 */
const MESSAGE_ID_SUBJECT =
	/\bMessage [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'s\b/gi;

export const humanizeSpamFailureReason = (reason: string): string =>
	reason.replace(MESSAGE_ID_SUBJECT, "This message's");

/**
 * `settleSpamReportBulk` (backend) runs the batch with `Promise.allSettled`
 * and always answers 200, folding per-message outcomes into
 * `successCount`/`failureCount`/`failures` rather than rejecting the HTTP
 * call — a partial (or total) failure is not a thrown error on the wire. The
 * generated mutation helpers only ever reject on a non-2xx response, so
 * without this the hook would report success for a message whose report or
 * undo never actually happened. Every caller here sends exactly one message
 * per call, so surfacing the first failure's reason is surfacing the whole
 * story, not truncating a real batch.
 *
 * Throws `ApiError` — not a bare `Error` — carrying a 4xx status. The
 * client's fatal/banner split (`lib/error-classifier.ts`) treats a
 * statusless `Error` as a client bug and routes it to the full-screen fatal
 * overlay with no retry, which is wrong for a designed, expected, retryable
 * outcome the backend wrote user-facing copy for. Every other call site in
 * this app forwards a status-carrying error the generated client already
 * threw; this is the one place synthesizing a failure from a 200 body, so it
 * has to synthesize a status too.
 */
export const throwOnBulkFailure = (
	data: RemitImapSpamReportBulkResult,
): void => {
	if (data.failureCount === 0) return;
	const reason = data.failures?.[0]?.reason ?? GENERIC_SPAM_ACTION_FAILURE;
	throw new ApiError(humanizeSpamFailureReason(reason), 422);
};

/**
 * Composes `POST /messages/report-spam` and `POST /messages/not-spam`
 * (issue #648). Both fold the sender-flag write, the Junk move and the
 * `$Junk` keyword marker into one server-side operation
 * (`SpamReportService`) — the client only sends `messageIds` and reflects the
 * result, it does not sequence the three writes itself, and it never derives
 * "reported" from placement (a report on a message already in Junk — the
 * provider's own filter put it there — is a real, no-op-move case).
 *
 * No optimistic cache patch, unlike `useMoveMessages`/`useDeleteMessages`:
 * neither endpoint's response says whether the message actually changed
 * mailboxes (a report or undo against a message already in Junk is a real,
 * silent no-op), so predicting the row should vanish would flicker it back
 * on invalidation for a no-op — worst on `notSpam`, whose R2 wait can run
 * several seconds before the row "pops back". The list settles from
 * `onSuccess`'s invalidation instead, which is always correct, at the cost
 * of losing the instant-optimistic feel `useMoveMessages` has for a move
 * whose destination is known upfront.
 */
export function useReportSpam({
	mailboxId,
	threadId,
	accountId,
	onAfterOptimisticRemove,
}: UseReportSpamOptions) {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const listPrefixes = threadListCacheKeys([mailboxId]);
	const threadMessagesPrefix = threadId
		? threadDetailOperationsListThreadMessagesQueryKey({ path: { threadId } })
		: [];

	const invalidateAffectedQueries = () => {
		if (threadId) {
			queryClient.invalidateQueries({ queryKey: threadMessagesPrefix });
		}
		invalidateThreadListQueries(queryClient, listPrefixes);
		if (accountId) {
			queryClient.invalidateQueries({
				queryKey: mailboxOperationsListMailboxesQueryKey({
					path: { accountId },
				}),
			});
		}
	};

	const buildOnSuccess =
		() => (_data: unknown, variables: { body: { messageIds: string[] } }) => {
			invalidateAffectedQueries();
			onAfterOptimisticRemove?.(variables.body.messageIds);
		};

	const buildOnError =
		(failureTitle: (count: number) => string) =>
		(err: unknown, vars: { body: { messageIds: string[] } }) => {
			pushError({
				title: failureTitle(vars.body.messageIds.length),
				detail: formatErrorDetail(err),
				error: err,
			});
		};

	const report = useMutation({
		mutationFn: async (variables: { body: { messageIds: string[] } }) => {
			const { data } = await messageBulkOperationsReportSpam({
				...variables,
				throwOnError: true,
			});
			throwOnBulkFailure(data);
			return data;
		},
		onSuccess: buildOnSuccess(),
		onError: buildOnError((count) =>
			count > 1
				? `Couldn't report ${count} messages as spam`
				: "Couldn't report this message as spam",
		),
	});

	const restore = useMutation({
		mutationFn: async (variables: { body: { messageIds: string[] } }) => {
			const { data } = await messageBulkOperationsNotSpam({
				...variables,
				throwOnError: true,
			});
			throwOnBulkFailure(data);
			return data;
		},
		onSuccess: buildOnSuccess(),
		onError: buildOnError((count) =>
			count > 1
				? `Couldn't undo the spam report for ${count} messages`
				: "Couldn't undo the spam report",
		),
	});

	const reportSpam = useCallback(
		(messageIds: string[]) => {
			if (messageIds.length === 0) return;
			void runChunkedMutation(messageIds, (chunk) =>
				report.mutateAsync({ body: { messageIds: chunk } }),
			);
		},
		[report.mutateAsync],
	);

	const notSpam = useCallback(
		(messageIds: string[]) => {
			if (messageIds.length === 0) return;
			void runChunkedMutation(messageIds, (chunk) =>
				restore.mutateAsync({ body: { messageIds: chunk } }),
			);
		},
		[restore.mutateAsync],
	);

	return {
		reportSpam,
		notSpam,
		isReporting: report.isPending,
		isRestoring: restore.isPending,
		/**
		 * Message ids the last report-spam attempt failed for — `undefined` once
		 * a new attempt starts or the last one succeeded. Callers compare against
		 * the specific message they're rendering rather than reading `isError`
		 * directly: this hook is shared across every open message in a mailbox
		 * (no per-message instance), so a bare boolean would keep reading "failed"
		 * after the user moves on to a message that was never reported.
		 */
		reportFailedMessageIds: report.isError
			? report.variables?.body.messageIds
			: undefined,
		restoreFailedMessageIds: restore.isError
			? restore.variables?.body.messageIds
			: undefined,
		/**
		 * The failure itself, paired with the ids above — its `message` is
		 * either the server's own allowlisted reason (e.g. `notSpam`'s
		 * move-not-settled-yet text, with the raw UUID cleaned up) or the
		 * flattened generic one, both safe to show as-is. `undefined` under the
		 * same reset rule as `reportFailedMessageIds`.
		 */
		reportError: report.isError ? report.error : undefined,
		restoreError: restore.isError ? restore.error : undefined,
	};
}
