import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { abandonedMutationOf } from "@remit/data-ports/message-settlement";
import { MessageMutation } from "@remit/domain-enums";
import { MessageSettlementNotice, messageSettlementCopy } from "@remit/ui";
import { useCallback, useMemo } from "react";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import { MoveToTrigger } from "./MoveToTrigger";

/**
 * States, on the open message, that Remit gave up on a mutation (issue #1002) —
 * the failure the list can only chip — and offers the way out for THAT
 * mutation, never a different one (issue #1229).
 *
 * A delete retries through the ordinary delete endpoint: giving up put `status`
 * back to `active`, so `settledPlacement` passes the row through and
 * `POST /messages/delete` re-drives it against the folder the server actually
 * holds it in. A move cannot retry that way — the destination the give-up
 * discarded is on no row — so its retry is the same folder picker every other
 * move goes through, which asks for one. Every other give-up gets no treatment;
 * `abandonedMutationOf` says which and why.
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
	const abandoned = abandonedMutationOf(threadMessage);
	const settlement =
		abandoned === MessageMutation.delete
			? ("delete_failed" as const)
			: abandoned === MessageMutation.move
				? ("move_failed" as const)
				: undefined;

	const { deleteMessages, isPending: isDeleting } = useDeleteMessages({
		mailboxId: threadMessage.mailboxId,
		threadId: threadMessage.threadId,
		accountId,
		messages: [threadMessage],
	});
	const { moveMessages, isPending: isMoving } = useMoveMessages({
		mailboxId: threadMessage.mailboxId,
		threadId: threadMessage.threadId,
		accountId,
	});

	const onDeleteAgain = useCallback(() => {
		deleteMessages([threadMessage.messageId]);
	}, [deleteMessages, threadMessage.messageId]);

	const onMoveAgain = useCallback(
		(destinationMailboxId: string) => {
			moveMessages([threadMessage.messageId], destinationMailboxId);
		},
		[moveMessages, threadMessage.messageId],
	);

	const reportHref = useMemo(
		() =>
			settlement
				? buildGitHubIssueUrl(
						buildBugReportContext({
							title: messageSettlementCopy[settlement].title,
							errorMessage: `Message ${threadMessage.messageId}: status=${threadMessage.status} syncStatus=${threadMessage.syncStatus} abandonedMutation=${threadMessage.abandonedMutation}`,
						}),
					)
				: undefined,
		[
			settlement,
			threadMessage.messageId,
			threadMessage.status,
			threadMessage.syncStatus,
			threadMessage.abandonedMutation,
		],
	);

	if (!settlement) return null;

	return (
		<MessageSettlementNotice
			settlement={settlement}
			onRetry={settlement === "delete_failed" ? onDeleteAgain : undefined}
			action={
				settlement === "move_failed" && accountId ? (
					<MoveToTrigger
						accountId={accountId}
						currentMailboxId={threadMessage.mailboxId}
						onMove={onMoveAgain}
						disabled={isMoving}
						variant="compact"
						label={messageSettlementCopy.move_failed.retryLabel}
					/>
				) : undefined
			}
			retryPending={settlement === "delete_failed" ? isDeleting : isMoving}
			reportHref={reportHref}
			className={className}
		/>
	);
}
