import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { hasAbandonedDelete } from "@remit/data-ports/message-settlement";
import { MessageSettlementNotice, messageSettlementCopy } from "@remit/ui";
import { useCallback, useMemo } from "react";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";

/**
 * States, on the open message, that Remit abandoned its delete (issue #1002) —
 * the failure the list can only chip.
 *
 * The retry is the ordinary delete endpoint, not a new one: abandoning put
 * `status` back to `active`, so `settledPlacement` passes the row through and
 * `POST /messages/delete` re-drives it against the folder the server actually
 * holds it in. Every other give-up gets no treatment — see `hasAbandonedDelete`
 * for the three the two fields cannot tell from a healthy row.
 */
export function MessageSettlementAlert({
	threadMessage,
	accountId,
	className,
}: {
	threadMessage: RemitImapThreadMessageResponse;
	accountId: string | undefined;
	className?: string;
}) {
	const abandoned = hasAbandonedDelete(threadMessage);
	const { deleteMessages, isPending } = useDeleteMessages({
		mailboxId: threadMessage.mailboxId,
		threadId: threadMessage.threadId,
		accountId,
		messages: [threadMessage],
	});

	const onRetry = useCallback(() => {
		deleteMessages([threadMessage.messageId]);
	}, [deleteMessages, threadMessage.messageId]);

	const reportHref = useMemo(
		() =>
			abandoned
				? buildGitHubIssueUrl(
						buildBugReportContext({
							title: messageSettlementCopy.delete_failed.title,
							errorMessage: `Message ${threadMessage.messageId}: status=${threadMessage.status} syncStatus=${threadMessage.syncStatus}`,
						}),
					)
				: undefined,
		[
			abandoned,
			threadMessage.messageId,
			threadMessage.status,
			threadMessage.syncStatus,
		],
	);

	if (!abandoned) return null;

	return (
		<MessageSettlementNotice
			settlement="delete_failed"
			onRetry={onRetry}
			retryPending={isPending}
			reportHref={reportHref}
			className={className}
		/>
	);
}
