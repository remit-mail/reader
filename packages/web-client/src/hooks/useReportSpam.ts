import {
	mailboxOperationsListMailboxesQueryKey,
	threadDetailOperationsListThreadMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	messageBulkOperationsNotSpam,
	messageBulkOperationsReportSpam,
} from "@remit/api-http-client/sdk.gen.ts";
import type {
	RemitImapSpamReportBulkResult,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { runChunkedMutation } from "@/lib/bulk-actions";
import {
	cancelThreadListQueries,
	invalidateThreadListQueries,
	patchThreadListQueries,
	restoreThreadListQueries,
	snapshotThreadListQueries,
	type ThreadListSnapshotEntry,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";
import { removeMovedMessagesFromItems } from "./useMoveMessages";

interface UseReportSpamOptions {
	/** The mailbox the message currently sits in — the cached list the row optimistically drops from. */
	mailboxId: string;
	threadId?: string;
	accountId?: string;
}

interface ThreadMessagesData {
	items: RemitImapThreadMessageResponse[];
	[key: string]: unknown;
}

interface SpamActionContext {
	threadMessagesPrefix: readonly unknown[];
	listPrefixes: ReadonlyArray<readonly unknown[]>;
	previousThreadMessages: {
		queryKey: readonly unknown[];
		data: ThreadMessagesData;
	}[];
	previousThreadsList: ThreadListSnapshotEntry[];
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
 * `settleSpamReportBulk` (backend) runs the batch with `Promise.allSettled`
 * and always answers 200, folding per-message outcomes into
 * `successCount`/`failureCount`/`failures` rather than rejecting the HTTP
 * call — a partial (or total) failure is not a thrown error on the wire. The
 * generated mutation helpers only ever reject on a non-2xx response, so
 * without this the hook would report success for a message whose report or
 * undo never actually happened. Every caller here sends exactly one message
 * per call, so surfacing the first failure's reason is surfacing the whole
 * story, not truncating a real batch.
 */
export const throwOnBulkFailure = (
	data: RemitImapSpamReportBulkResult,
): void => {
	if (data.failureCount === 0) return;
	throw new Error(data.failures?.[0]?.reason ?? GENERIC_SPAM_ACTION_FAILURE);
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
 * Both endpoints share the same request shape and the same client-side
 * approximation (the row optimistically leaves the mailbox it's rendered in,
 * restored on failure, reconciled by invalidation on settle), so the two
 * mutations below are deliberately near-identical — mirrors `useMoveMessages`.
 */
export function useReportSpam({
	mailboxId,
	threadId,
	accountId,
}: UseReportSpamOptions) {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const listPrefixes = threadListCacheKeys([mailboxId]);
	const threadMessagesPrefix = threadId
		? threadDetailOperationsListThreadMessagesQueryKey({ path: { threadId } })
		: [];

	const onMutate = async (variables: {
		body: { messageIds: string[] };
	}): Promise<SpamActionContext> => {
		const messageIds = new Set(variables.body.messageIds);

		await Promise.all([
			...(threadId
				? [queryClient.cancelQueries({ queryKey: threadMessagesPrefix })]
				: []),
			cancelThreadListQueries(queryClient, listPrefixes),
		]);

		const previousThreadMessages = threadId
			? queryClient
					.getQueriesData<ThreadMessagesData>({
						queryKey: threadMessagesPrefix,
					})
					.filter(
						(entry): entry is [readonly unknown[], ThreadMessagesData] =>
							entry[1] !== undefined,
					)
					.map(([queryKey, data]) => ({ queryKey, data }))
			: [];

		const previousThreadsList = snapshotThreadListQueries(
			queryClient,
			listPrefixes,
		);

		if (threadId) {
			queryClient.setQueriesData<ThreadMessagesData>(
				{ queryKey: threadMessagesPrefix },
				(old) => {
					if (!old) return old;
					return {
						...old,
						items: removeMovedMessagesFromItems(old.items, messageIds),
					};
				},
			);
		}

		patchThreadListQueries(queryClient, listPrefixes, (items) =>
			removeMovedMessagesFromItems(items, messageIds),
		);

		return {
			threadMessagesPrefix,
			listPrefixes,
			previousThreadMessages,
			previousThreadsList,
		};
	};

	const buildOnError =
		(failureTitle: (count: number) => string) =>
		(
			err: unknown,
			vars: { body: { messageIds: string[] } },
			context: SpamActionContext | undefined,
		) => {
			if (context) {
				for (const entry of context.previousThreadMessages) {
					queryClient.setQueryData(entry.queryKey, entry.data);
				}
				restoreThreadListQueries(queryClient, context.previousThreadsList);
			}
			pushError({
				title: failureTitle(vars.body.messageIds.length),
				detail: formatErrorDetail(err),
				error: err,
			});
		};

	const onSettled = (
		_data: unknown,
		_err: unknown,
		_vars: unknown,
		context: SpamActionContext | undefined,
	) => {
		if (!context) return;
		if (threadId) {
			queryClient.invalidateQueries({
				queryKey: context.threadMessagesPrefix,
			});
		}
		invalidateThreadListQueries(queryClient, context.listPrefixes);
		if (accountId) {
			queryClient.invalidateQueries({
				queryKey: mailboxOperationsListMailboxesQueryKey({
					path: { accountId },
				}),
			});
		}
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
		onMutate,
		onError: buildOnError((count) =>
			count > 1
				? `Couldn't report ${count} messages as spam`
				: "Couldn't report this message as spam",
		),
		onSettled,
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
		onMutate,
		onError: buildOnError((count) =>
			count > 1
				? `Couldn't undo the spam report for ${count} messages`
				: "Couldn't undo the spam report",
		),
		onSettled,
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
		 * move-not-settled-yet text) or the flattened generic one, both safe to
		 * show as-is (`SpamReportFailure.reason` is documented user-facing).
		 * `undefined` under the same reset rule as `reportFailedMessageIds`.
		 */
		reportError: report.isError ? report.error : undefined,
		restoreError: restore.isError ? restore.error : undefined,
	};
}
